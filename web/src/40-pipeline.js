// ---------------------------------------------------------------- pipeline
const STEPS = ["script", "script_check", "scenes", "voice", "visuals", "music", "captions", "assemble", "final_check"];
const WORKER_STEPS = {
  writer: ["script", "script_check", "scenes"], voice: ["voice"], visuals: ["visuals"], captions: ["captions"], editor: ["music", "assemble", "final_check"],
};
const DOWNSTREAM = {
  script: ["script_check", "scenes", "voice", "visuals", "music", "captions", "assemble", "final_check"],
  script_check: [], scenes: ["visuals", "assemble", "final_check"], voice: ["music", "captions", "assemble", "final_check"],
  visuals: ["assemble", "final_check"], music: ["assemble", "final_check"], captions: ["assemble", "final_check"],
  assemble: ["final_check"], final_check: [],
};
const emptySteps = () => Object.fromEntries(STEPS.map((s) => [s, { status: "waiting", attempts: 0 }]));

async function addCost(projectId, cost) {
  if (cost) await update("projects", projectId, (p) => ({ cost: (p.cost || 0) + cost }));
}

/** Try each provider in order; retry temporary failures with backoff; fall back to the next. */
async function withProviders(cap, ctx, fn) {
  const avoid = [...(ctx.project.avoid || []), ...(ctx.state.avoid || [])];
  const list = chain(cap, avoid);
  if (!list.length) throw new ProviderError("missing_key", `No ${cap} provider available`);
  let last;
  for (const p of list) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fn(p);
        down.delete(p.id);
        return { result: r, provider: p };
      } catch (e) {
        last = toProviderError(e, p.id);
        last.provider = last.provider || p.id;
        if (last.retryable && a < 2) {
          await sleep(1500 * 2 ** a);
          continue;
        }
        if (["auth", "quota", "missing_key", "network"].includes(last.code)) down.set(p.id, Date.now() + 5 * 60000);
        break;
      }
    }
  }
  throw last;
}

async function llm(ctx, task, tier, p, input) {
  const key = "cache:" + (await hash("llm", task, tier, p.system, p.prompt, ctx.state.seed || 0));
  const hit = await kv.get(key);
  const avoid = [...(ctx.project.avoid || []), ...(ctx.state.avoid || [])];
  if (hit && !avoid.includes(hit.provider) && providerById(hit.provider)?.available()) return { json: hit.json, provider: hit.provider, cost: 0 };
  const { result, provider } = await withProviders("llm", ctx, async (prov) => {
    const r = await prov.complete({ task, tier, ...p, input });
    return { r, json: parseJson(r.text) };
  });
  await kv.set(key, { json: result.json, provider: provider.id });
  return { json: result.json, provider: provider.id, cost: result.r.cost };
}

function normalizeScript(j) {
  const lines = (Array.isArray(j?.lines) ? j.lines : []).map((l) => String(l).trim()).filter(Boolean);
  if (lines.length < 3) throw new ProviderError("bad_output", "Script came back too short: " + JSON.stringify(j).slice(0, 300), { retryable: true });
  return {
    title: String(j.title || lines[0]).slice(0, 80), hook: lines[0], lines,
    caption: String(j.caption || ""), hashtags: (Array.isArray(j.hashtags) ? j.hashtags : []).map(String).slice(0, 8),
  };
}
function localScriptIssues(s, lengthSec, lang = "English") {
  const issues = [];
  const n = countUnits(s.lines.join(" "), lang);
  const target = targetWords(lengthSec, lang);
  const unit = unitName(lang);
  if (n < target * 0.7) issues.push(`Too short: ${n} ${unit}, need about ${target}.`);
  if (n > target * 1.35) issues.push(`Too long: ${n} ${unit}, need about ${target}.`);
  if (/^(hi|hello|hey|welcome to my|today|in this video|so,)/i.test(s.lines[0])) issues.push("Boring intro: start with the hook.");
  if (s.lines[0].split(/\s+/).length > 24) issues.push("Hook is too long. Make line 1 punchier.");
  return issues;
}
const blobKey = (v, name) => `${v.id}:${name}:${Date.now().toString(36)}`;

const STEP_FNS = {
  async script(ctx) {
    const { project: P, video: V } = ctx;
    const p = scriptPrompt({ idea: V.idea, request: P.request, format: P.format, lengthSec: P.lengthSec, language: P.language, refs: P.refs });
    const r = await llm(ctx, "script", "quality", p, { idea: V.idea, angle: V.angle, request: P.request, format: P.format, lengthSec: P.lengthSec });
    return { output: normalizeScript(r.json), provider: r.provider, cost: r.cost };
  },
  async script_check(ctx) {
    const { project: P, video: V } = ctx;
    const s = V.steps.script.output;
    if (V.steps.script.provider === "edited") return { output: { edited: true, issues: [] } };
    // practice templates only write English: don't measure them against another language
    const lang = ctx.video.steps.script.provider === "offline-writer" ? "English" : P.language;
    const local = localScriptIssues(s, P.lengthSec, lang);
    const chk = await llm(ctx, "check", "cheap", checkPrompt(s, P.lengthSec, P.language), { script: s });
    const sc = chk.json || {};
    const ai = Array.isArray(sc.issues) ? sc.issues.map(String) : [];
    const weak = ["hook", "pacing", "escalation", "ending"].filter((k) => Number(sc[k]) > 0 && Number(sc[k]) < 7);
    if (!local.length && sc.pass !== false && !weak.length) return { output: { scores: sc, issues: [] }, provider: chk.provider, cost: chk.cost };
    const issues = [...local, ...ai].slice(0, 6);
    const rw = await llm(ctx, "rewrite", "quality", rewritePrompt({ script: s, issues, format: P.format, lengthSec: P.lengthSec, language: P.language, refs: P.refs }), {
      idea: V.idea + " (v2)", angle: V.angle, request: P.request, format: P.format, lengthSec: P.lengthSec,
    });
    await ctx.patchStep("script", { output: normalizeScript(rw.json) });
    return { output: { scores: sc, issues, rewrote: true }, provider: chk.provider, cost: chk.cost + rw.cost };
  },
  async scenes(ctx) {
    const lines = ctx.video.steps.script.output.lines;
    const r = await llm(ctx, "scenes", "cheap", scenesPrompt(lines, ctx.project.format), { lines, format: ctx.project.format });
    const raw = Array.isArray(r.json?.scenes) ? r.json.scenes : [];
    if (!raw.length) throw new ProviderError("bad_output", "No scenes returned", { retryable: true });
    const seen = new Set();
    const out = lines.map((line, i) => {
      const sc = raw[i] || raw[raw.length - 1];
      let visual = String(sc?.visual || line).trim();
      if (seen.has(visual.toLowerCase())) visual += ", different angle and composition";
      seen.add(visual.toLowerCase());
      return { text: line, visual, search: String(sc?.search || line.split(" ").slice(0, 3).join(" ")) };
    });
    return { output: out, provider: r.provider, cost: r.cost };
  },
  async voice(ctx) {
    const text = ctx.video.steps.script.output.lines.join(" ");
    const { result, provider } = await withProviders("voice", ctx, (p) => p.speak({ text, style: ctx.project.format.voiceStyle, language: ctx.project.language }));
    if (!result.blob) return { output: { none: true, duration: result.duration }, provider: provider.id, cost: 0 };
    const buf = await decodeAudio(result.blob).catch(() => null);
    if (!buf || buf.duration < 1) throw new ProviderError("bad_output", "Voice audio is empty", { provider: provider.id, retryable: true });
    const key = blobKey(ctx.video, "voice");
    await blobs.put(key, result.blob);
    return { output: { key, duration: buf.duration }, provider: provider.id, cost: result.cost };
  },
  async visuals(ctx) {
    const scenes = ctx.video.steps.scenes.output;
    const done = [...(ctx.state.output?.partial || [])];
    let cost = 0;
    for (let i = done.length; i < scenes.length; i++) {
      const s = scenes[i];
      const { result, provider } = await withProviders("image", ctx, (p) =>
        p.generate({ prompt: s.visual, search: s.search, text: s.text, format: ctx.project.format, avoid: done.map((d) => d.sourceId).filter(Boolean) }),
      );
      const key = blobKey(ctx.video, "scene" + i);
      await blobs.put(key, result.blob);
      cost += result.cost || 0;
      done.push({ key, provider: provider.id, sourceId: result.sourceId });
      await ctx.progress({ partial: done }); // keep finished images if a later one fails
    }
    return { output: { images: done.map((d) => d.key), partial: done }, provider: [...new Set(done.map((d) => d.provider))].join(", "), cost };
  },
  async music(ctx) {
    const style = ctx.project.format.musicStyle;
    if (!style || style === "none") return { output: { none: true }, skipped: true };
    return { output: { style }, provider: "generated" };
  },
  async captions(ctx) {
    const v = ctx.video.steps.voice.output;
    const text = ctx.video.steps.script.output.lines.join(" ");
    const audio = v.key ? await blobs.get(v.key) : null;
    const { result, provider } = await withProviders("captions", ctx, (p) => p.timings({ audio, text, duration: v.duration, language: ctx.project.language }));
    return { output: { words: result.words }, provider: provider.id, cost: result.cost };
  },
  async assemble(ctx) {
    const st = ctx.video.steps;
    const images = await Promise.all(st.visuals.output.images.map((k) => blobs.get(k)));
    if (images.some((b) => !b)) throw new ProviderError("missing_asset", "A scene image is missing");
    const voiceBlob = st.voice.output.key ? await blobs.get(st.voice.output.key) : null;
    if (st.voice.output.key && !voiceBlob) throw new ProviderError("missing_asset", "Voice audio is missing");
    try {
      const out = await withRenderLock(() =>
        renderVideo({
          images, weights: st.scenes.output.map((s) => s.text.length + 10),
          words: st.captions.status === "done" ? st.captions.output.words : [],
          captionStyle: ctx.project.format.captionStyle, voiceBlob, duration: st.voice.output.duration,
          musicStyle: st.music.status === "done" ? st.music.output.style : null,
          onProgress: (p) => ctx.setLive({ render: p }),
        }),
      );
      const key = blobKey(ctx.video, "final");
      await blobs.put(key, out.blob);
      return { output: { key, ext: out.ext, codec: out.codec, size: out.blob.size }, provider: "browser" };
    } catch (e) {
      throw new ProviderError("render_failed", e?.message || String(e), { provider: "browser", retryable: false });
    }
  },
  async final_check(ctx) {
    const st = ctx.video.steps;
    const blob = await blobs.get(st.assemble.output.key);
    if (!blob) throw new ProviderError("missing_asset", "Finished video is missing");
    const p = await probeVideo(blob).catch(() => null);
    const speech = st.voice.output.duration;
    const checks = [
      { name: "Vertical 9:16 (1080×1920)", ok: !p || (p.width === 1080 && p.height === 1920) },
      { name: "Length matches the narration", ok: !p || !isFinite(p.duration) || Math.abs(p.duration - (speech + 0.8)) < 2 },
      { name: "All scenes have visuals", ok: st.visuals.output.images.length === st.scenes.output.length },
      { name: "Under 3 minutes", ok: speech < 180 },
      { name: "File isn't empty", ok: blob.size > 10000 },
    ];
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) throw new ProviderError("quality_failed", "Final check failed: " + failed.map((f) => f.name).join(", "));
    return { output: { checks } };
  },
};

// ---------------------------------------------------------------- runner + queue
let renderChain = Promise.resolve();
function withRenderLock(fn) {
  const run = renderChain.then(fn, fn);
  renderChain = run.catch(() => {});
  return run;
}
const live = {}; // videoId -> { render: 0..1 } (not persisted)
const queue = [];
const running = new Set();
const CONCURRENCY = 2;

function enqueue(videoId) {
  if (!queue.includes(videoId) && !running.has(videoId)) queue.push(videoId);
  pump();
}
function pump() {
  while (running.size < CONCURRENCY && queue.length) {
    const id = queue.shift();
    running.add(id);
    runVideo(id)
      .catch((e) => console.error("runVideo crashed", e))
      .finally(() => {
        running.delete(id);
        delete live[id];
        changed();
        pump();
      });
  }
}
const setStep = (id, step, patch) => update("videos", id, (v) => ({ steps: { ...v.steps, [step]: { ...v.steps[step], ...patch, updatedAt: now() } } }));

async function runVideo(id) {
  let video = await db.get("videos", id);
  if (!video) return;
  const project = await db.get("projects", video.projectId);
  if (!project || project.deletedAt) return;
  video = await update("videos", id, { status: "working" });
  for (const step of STEPS) {
    const state = video.steps[step];
    if (state.status === "done" || state.status === "skipped") continue;
    video = await setStep(id, step, { status: "working", attempts: (state.attempts || 0) + 1, error: undefined });
    try {
      const res = await STEP_FNS[step]({
        project, video, state: video.steps[step],
        progress: async (output) => (video = await setStep(id, step, { output })),
        patchStep: async (s, patch) => (video = await setStep(id, s, patch)),
        setLive: (o) => {
          live[id] = { ...live[id], ...o };
          bus.dispatchEvent(new Event("live"));
        },
      });
      video = await setStep(id, step, { status: res.skipped ? "skipped" : "done", output: res.output, provider: res.provider, error: undefined });
      if (step === "script") video = await update("videos", id, { title: res.output.title });
      await addCost(project.id, res.cost);
      await resolveErrors((e) => e.videoId === id && e.step === step);
    } catch (e) {
      const fe = friendly(e, step);
      await setStep(id, step, { status: "error", error: fe });
      await update("videos", id, { status: "needs_attention" });
      await logError(project.id, id, step, fe);
      await refreshProject(project.id);
      return;
    }
  }
  await update("videos", id, { status: "done" });
  await refreshProject(project.id);
}

async function refreshProject(projectId) {
  const vs = await db.byIndex("videos", "projectId", projectId);
  if (!vs.length) return;
  const status = vs.some((v) => v.status === "queued" || v.status === "working") ? "generating" : vs.some((v) => v.status === "needs_attention") ? "needs_attention" : "done";
  await update("projects", projectId, { status });
}

/** On page load: pick up anything that was interrupted (tab closed, reload, crash). */
async function resumeAll() {
  const vs = (await db.all("videos")).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const v of vs) {
    if (v.status !== "queued" && v.status !== "working") continue;
    const p = await db.get("projects", v.projectId);
    if (!p || p.deletedAt) continue;
    const steps = Object.fromEntries(Object.entries(v.steps).map(([k, s]) => [k, s.status === "working" ? { ...s, status: "waiting" } : s]));
    await db.put("videos", { ...v, steps, status: "queued" });
    enqueue(v.id);
  }
  for (const p of await db.all("projects")) if (p.status === "planning" && !p.deletedAt && !p.ideaError) planProject(p.id);
}

// ---------------------------------------------------------------- projects
async function createProject({ request, contentType, count, lengthSec, language, refs }) {
  request = request.trim().slice(0, 2000);
  if (!request) throw new Error("Type what you want to make first ✍️");
  contentType = (contentType || "").trim().slice(0, 200);
  const n = count && count > 0 ? Math.min(50, count) : parseCount(request);
  const p = {
    id: uid(), title: request.replace(/^(please\s+)?(make|create|generate)\s+(me\s+)?/i, "").slice(0, 70), request, contentType,
    format: fallbackStyle(contentType, request), styleReady: false, count: n, lengthSec: lengthSec || null, language: language || "English",
    refs: refs && (refs.links?.length || refs.note) ? { links: refs.links || [], note: refs.note || "", info: null } : null,
    status: "planning", ideas: [], avoid: [], cost: 0, deletedAt: null, createdAt: now(), updatedAt: now(),
  };
  await db.put("projects", p);
  planProject(p.id);
  return p;
}

/** Work out the style from the content type (AI if connected), then ideas, then videos. */
async function planProject(projectId) {
  let p = await db.get("projects", projectId);
  if (!p) return;
  // look up reference video titles once (only where the site allows it)
  if (p.refs?.links?.length && !p.refs.info) {
    const info = await Promise.all(p.refs.links.map(refInfo));
    p = await update("projects", projectId, (x) => ({ refs: { ...x.refs, info } }));
  }
  if (!p.styleReady) {
    let style = p.format;
    const prov = chain("llm", p.avoid || []).find((x) => !x.offline);
    if (prov) {
      try {
        const key = "style:" + (await hash(p.contentType, p.contentType ? "" : p.request, refsText(p.refs)));
        let j = await kv.get(key);
        if (!j) {
          const r = await prov.complete({ task: "style", tier: "cheap", ...designPrompt(p.contentType, p.request, p.refs), input: {} });
          j = parseJson(r.text);
          await kv.set(key, j);
          await addCost(projectId, r.cost);
        }
        style = cleanStyle(j, p.format);
      } catch (e) {
        console.warn("style design failed, using the built-in match", e);
      }
    }
    p = await update("projects", projectId, (x) => ({ format: style, styleReady: true, lengthSec: x.lengthSec || style.lengthSec }));
  }
  if (p.count === 1) {
    if (!(await db.byIndex("videos", "projectId", projectId)).length) await createVideos(p, [{ title: p.title, angle: p.request }]);
  } else await planIdeas(projectId);
}

async function planIdeas(projectId) {
  const p = await db.get("projects", projectId);
  if (!p || (await db.byIndex("videos", "projectId", projectId)).length) return;
  let ideas = [];
  const pr = ideasPrompt(p.request, p.format, p.count, p.language, p.refs);
  let lastErr;
  for (const prov of chain("llm", p.avoid || [])) {
    try {
      const r = await prov.complete({ task: "ideas", tier: "cheap", ...pr, input: { request: p.request, count: p.count, format: p.format } });
      const j = parseJson(r.text);
      ideas = (Array.isArray(j.ideas) ? j.ideas : []).map((x) => ({ title: String(x.title || "").slice(0, 80), angle: String(x.angle || x.title || "") })).filter((x) => x.angle);
      await addCost(projectId, r.cost);
      if (ideas.length) break;
    } catch (e) {
      lastErr = toProviderError(e, prov.id);
      lastErr.provider = lastErr.provider || prov.id;
      if (["auth", "quota", "network"].includes(lastErr.code)) down.set(prov.id, Date.now() + 5 * 60000);
    }
  }
  if (!ideas.length) {
    const fe = friendly(lastErr || new Error("No ideas returned"), "ideas");
    await update("projects", projectId, { status: "needs_attention", ideaError: fe });
    await logError(projectId, null, "ideas", fe);
    return;
  }
  while (ideas.length < p.count) ideas.push({ ...ideas[ideas.length % ideas.length], title: `${ideas[0].title} #${ideas.length + 1}` });
  ideas = ideas.slice(0, p.count);
  await update("projects", projectId, { ideas, ideaError: null });
  await resolveErrors((e) => e.projectId === projectId && e.step === "ideas");
  await createVideos(p, ideas);
}

async function createVideos(p, ideas, startIndex = 0) {
  const t = Date.now();
  for (const [i, idea] of ideas.entries()) {
    const v = {
      id: uid(), projectId: p.id, index: startIndex + i, title: idea.title || `Video ${startIndex + i + 1}`,
      idea: `${idea.title}. ${idea.angle}`.trim(), angle: idea.angle, status: "queued", steps: emptySteps(),
      createdAt: new Date(t + i).toISOString(), updatedAt: now(),
    };
    await db.put("videos", v);
    enqueue(v.id);
  }
  await update("projects", p.id, { status: "generating" });
}

function resetSteps(v, steps, bump) {
  const next = { ...v.steps };
  for (const s of steps) next[s] = { status: "waiting", attempts: 0, seed: bump ? (v.steps[s].seed || 0) + 1 : v.steps[s].seed };
  return next;
}

async function videoAction(id, action, step) {
  const v = await db.get("videos", id);
  const p = await db.get("projects", v.projectId);
  if (step && step !== "all" && v.steps[step]?.status === "working") throw new Error("That part is still working.");
  if (action === "regenerate") {
    const list = step === "all" || !step ? STEPS : [step, ...DOWNSTREAM[step]];
    await update("videos", id, (c) => ({ status: "queued", steps: resetSteps(c, list, true) }));
  } else {
    const target = step && step !== "all" ? step : STEPS.find((k) => v.steps[k].status === "error");
    if (!target) throw new Error("Nothing to fix here.");
    const cur = v.steps[target];
    if (action === "backup") {
      // stop using the failed provider for this whole project, re-queue every video stuck on it
      const bad = cur.error?.provider || cur.provider;
      if (bad) await update("projects", p.id, (x) => ({ avoid: [...new Set([...(x.avoid || []), ...bad.split(", ")])] }));
      for (const x of await db.byIndex("videos", "projectId", p.id)) {
        const stuck = STEPS.filter((k) => x.steps[k].status === "error" && (x.steps[k].error?.provider === bad || (x.id === id && k === target)));
        if (!stuck.length) continue;
        await update("videos", x.id, (c) => {
          const steps = { ...c.steps };
          for (const k of stuck) steps[k] = { ...steps[k], status: "waiting", error: undefined };
          return { status: "queued", steps };
        });
        enqueue(x.id);
      }
      await update("projects", p.id, { status: "generating" });
      return;
    }
    if (action === "skip" && cur.status === "error" && !cur.error?.canSkip) throw new Error("This part can't be skipped.");
    await update("videos", id, (c) => ({
      status: "queued",
      steps: { ...c.steps, [target]: { ...c.steps[target], status: action === "skip" ? "skipped" : "waiting", error: undefined } },
    }));
  }
  enqueue(id);
  await update("projects", p.id, { status: "generating" });
}

async function editScript(id, { title, lines, caption }) {
  const v = await db.get("videos", id);
  lines = lines.map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("A script needs at least 2 lines.");
  const old = v.steps.script.output;
  const script = { title: title?.trim() || old?.title || lines[0], hook: lines[0], lines, caption: caption ?? old?.caption ?? "", hashtags: old?.hashtags || [] };
  const same = old && old.lines.length === lines.length && v.steps.scenes.status === "done";
  const redo = same ? ["voice", "music", "captions", "assemble", "final_check"] : ["scenes", "voice", "visuals", "music", "captions", "assemble", "final_check"];
  await update("videos", id, (c) => {
    const steps = resetSteps(c, redo, false);
    steps.script = { ...c.steps.script, status: "done", provider: "edited", output: script, error: undefined };
    steps.script_check = { status: "done", attempts: 0, output: { edited: true, issues: [] } };
    if (same) steps.scenes = { ...c.steps.scenes, output: c.steps.scenes.output.map((s, i) => ({ ...s, text: lines[i] })) };
    return { title: script.title, status: "queued", steps };
  });
  enqueue(id);
  await update("projects", v.projectId, { status: "generating" });
}

async function duplicateVideo(id) {
  const v = await db.get("videos", id);
  const sib = await db.byIndex("videos", "projectId", v.projectId);
  const copy = { ...structuredClone(v), id: uid(), index: Math.max(...sib.map((s) => s.index)) + 1, title: `${v.title} (copy)`, createdAt: now(), updatedAt: now() };
  if (copy.status !== "done") {
    copy.status = "queued";
    for (const s of Object.values(copy.steps)) if (s.status === "working") s.status = "waiting";
  }
  await db.put("videos", copy);
  if (copy.status !== "done") enqueue(copy.id);
}

async function addVideos(projectId, n) {
  const p = await db.get("projects", projectId);
  const base = (await db.byIndex("videos", "projectId", projectId)).length;
  await createVideos(p, Array.from({ length: n }, (_, i) => ({ title: `${p.title} #${base + i + 1}`, angle: `${p.request} (fresh angle #${base + i + 1})` })), base);
}

async function retryIdeas(projectId, backup) {
  await update("projects", projectId, (p) => ({
    status: "planning", ideaError: null,
    avoid: backup && p.ideaError?.provider ? [...new Set([...(p.avoid || []), p.ideaError.provider])] : p.avoid,
  }));
  planProject(projectId);
}

/** Permanently delete trashed projects and their videos/files (frees browser storage). */
async function emptyTrash() {
  for (const p of await db.all("projects")) {
    if (!p.deletedAt) continue;
    for (const v of await db.byIndex("videos", "projectId", p.id)) {
      for (const k of videoBlobKeys(v)) await blobs.del(k);
      await db.del("videos", v.id);
    }
    await db.del("projects", p.id);
  }
}
function videoBlobKeys(v) {
  const s = v.steps;
  return [s.voice.output?.key, ...(s.visuals.output?.partial || []).map((x) => x.key), s.assemble.output?.key].filter(Boolean);
}

/** Title + creator of a reference link via the site's public oEmbed (YouTube, TikTok). Best effort. */
async function refInfo(url) {
  if (!canFetch()) return {};
  const api = /youtu\.?be/i.test(url)
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    : /tiktok\.com/i.test(url)
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      : null;
  if (!api) return {};
  try {
    const r = await fetch(api, { signal: timeout(6000) });
    if (!r.ok) return {};
    const j = await r.json();
    return { title: String(j.title || "").slice(0, 200), author: String(j.author_name || "").slice(0, 80) };
  } catch {
    return {};
  }
}
