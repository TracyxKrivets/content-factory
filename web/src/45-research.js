// ---------------------------------------------------------------- reference video research
// You upload a video; the app measures it (length, cuts, pace), grabs frames, gets the words
// (OpenAI transcription, when available) and asks the AI writer to study it. The notes then
// shape the style and the scripts of the videos you make.

const REF_LIST = "ref-files"; // kv: the uploaded reference videos on the Make page
const MAX_REF_FILES = 6;
const MAX_REF_MB = 300;

async function refFiles() {
  return (await kv.get(REF_LIST, [])) || [];
}
async function saveRefFiles(list) {
  await kv.set(REF_LIST, list);
}
async function patchRef(id, patch) {
  const list = await refFiles();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  await saveRefFiles(list);
  return list[i];
}

async function addRefFiles(fileList) {
  const files = [...fileList]; // read the list before any await
  const list = await refFiles();
  const added = [];
  for (const f of files) {
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|webm|m4v)$/i.test(f.name)) {
      toast(`${f.name} isn't a video file.`, true);
      continue;
    }
    if (f.size > MAX_REF_MB * 1e6) {
      toast(`${f.name} is too big (max ${MAX_REF_MB} MB). Try a shorter clip.`, true);
      continue;
    }
    if (list.length + added.length >= MAX_REF_FILES) {
      toast(`Up to ${MAX_REF_FILES} reference videos at a time.`, true);
      break;
    }
    const id = uid();
    await blobs.put("ref:" + id, f);
    added.push({ id, name: f.name, size: f.size, type: f.type, status: "waiting", addedAt: now() });
  }
  await saveRefFiles([...list, ...added]);
  for (const r of added) researchRef(r.id); // start studying right away
  return added.length;
}
async function removeRefFile(id) {
  await saveRefFiles((await refFiles()).filter((r) => r.id !== id));
  await blobs.del("ref:" + id);
  await blobs.del("refthumb:" + id);
}

// ---- measuring a video in the browser
function loadVideo(blob) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const url = URL.createObjectURL(blob);
    v.onloadeddata = () => res({ v, url });
    v.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("This browser can't open that video. MP4 files work best (MOV only works in Safari)."));
    };
    v.src = url;
  });
}
function seek(v, t) {
  return new Promise((res) => {
    const done = () => (v.removeEventListener("seeked", done), res());
    v.addEventListener("seeked", done);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
    setTimeout(done, 3000); // never hang on a bad frame
  });
}
function grab(v, width) {
  const h = Math.round((width * v.videoHeight) / v.videoWidth) || width;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = h;
  c.getContext("2d").drawImage(v, 0, 0, width, h);
  return c;
}
const toJpeg = (c, q = 0.82) => new Promise((r) => c.toBlob(r, "image/jpeg", q));

/** Frames + numbers: duration, shape, how often the picture cuts, how busy the motion is. */
async function measureVideo(blob, onStep) {
  const { v, url } = await loadVideo(blob);
  try {
    const duration = v.duration;
    if (!isFinite(duration) || duration <= 0) throw new Error("Couldn't read how long the video is.");
    const out = { duration, width: v.videoWidth, height: v.videoHeight, frames: [], frameTimes: [] };
    // cut detection: tiny grayscale frames, 4 per second, over the first 60 s
    onStep("Measuring cuts and pace");
    const span = Math.min(duration, 60);
    const step = 0.25;
    let prev = null;
    const diffs = [];
    for (let t = 0; t < span; t += step) {
      await seek(v, t);
      const c = grab(v, 48);
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      // compare full color (red and blue can have the same brightness)
      const g = new Float32Array((d.length / 4) * 3);
      for (let i = 0, j = 0; i < d.length; i += 4) (g[j++] = d[i]), (g[j++] = d[i + 1]), (g[j++] = d[i + 2]);
      if (prev) {
        let s = 0;
        for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - prev[i]);
        diffs.push(s / g.length);
      }
      prev = g;
    }
    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const cutThreshold = Math.max(28, median * 4);
    let cuts = 0;
    for (let i = 0; i < diffs.length; i++) if (diffs[i] > cutThreshold && (i === 0 || diffs[i - 1] <= cutThreshold)) cuts++;
    out.cuts = cuts;
    out.avgShot = +(span / (cuts + 1)).toFixed(1);
    out.motion = median < 4 ? "calm" : median < 10 ? "moderate" : "busy";
    // frames for the AI to look at
    onStep("Grabbing frames");
    const n = clamp(Math.round(duration / 4), 4, 8);
    const times = [Math.min(0.4, duration / 10), ...Array.from({ length: n - 1 }, (_, i) => ((i + 1) / n) * duration)];
    for (const t of times) {
      await seek(v, t);
      out.frames.push(await toJpeg(grab(v, 540)));
      out.frameTimes.push(+t.toFixed(1));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Transcribe the words with OpenAI (file version, with a key, files ≤ 25 MB). */
async function transcribe(blob, name) {
  if (!canFetch() || !keys.get("OPENAI_API_KEY") || blob.size > 25e6) return null;
  const form = new FormData();
  form.append("file", blob, /\.\w+$/.test(name) ? name : name + ".mp4");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", body: form, signal: timeout(180000), headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}` },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return { text: String(j.text || "").slice(0, 4000), language: j.language || null };
}

function researchPrompt(m, transcript) {
  return {
    system: "You study viral short-form videos (TikTok, Reels, Shorts) so a creator can make videos in the same style. Reply with JSON only.",
    prompt: `The attached images are frames from ONE reference video, in order, at these seconds: ${m.frameTimes.join(", ")}.
Measured: ${m.duration.toFixed(1)} s long, ${m.width}×${m.height}, about ${m.cuts} cuts in the first ${Math.min(60, Math.round(m.duration))} s (a new shot every ~${m.avgShot} s), motion ${m.motion}.
${transcript ? `What's said (transcript): ${transcript.text}` : "No transcript available: read any on-screen text in the frames."}
Study it and describe what makes it work, concretely enough to copy the style (not the content).
JSON: {"summary":"one line","hook":"how the first 2 seconds grab","structure":"beat by beat","pacing":"cuts, speed","visuals":"look, shots, colors, lighting","captions":"on-screen text style: size, color, position, words per caption","voice":"narration tone, or none","music":"feel, or none","copy":["3-6 specific things to copy"]}`,
    maxTokens: 900,
  };
}
/** Plain-language notes when no AI can look at the video: just the measurements. */
function measuredNotes(m, transcript) {
  const pace = m.avgShot < 1.5 ? "very fast cuts" : m.avgShot < 3 ? "fast cuts" : m.avgShot < 6 ? "steady cuts" : "long, slow shots";
  return {
    summary: `${Math.round(m.duration)} s ${m.height > m.width ? "vertical" : "horizontal"} video with ${pace}`,
    pacing: `About ${m.cuts} cuts (a new shot every ~${m.avgShot} s), ${m.motion} motion.`,
    voice: transcript ? `Narrated (${transcript.text.split(/\s+/).length} words)` : "",
    copy: [`Keep shots around ${m.avgShot} s`, m.duration <= 30 ? "Keep it under 30 seconds" : `Aim for about ${Math.round(m.duration)} seconds`],
    measuredOnly: true,
  };
}

const researching = new Set();
async function researchRef(id) {
  if (researching.has(id)) return;
  researching.add(id);
  const step = (s) => patchRef(id, { status: "working", step: s });
  try {
    await step("Opening the video");
    const blob = await blobs.get("ref:" + id);
    if (!blob) throw new Error("The video file is missing. Upload it again.");
    const rec = (await refFiles()).find((r) => r.id === id);
    const m = await measureVideo(blob, step);
    await blobs.put("refthumb:" + id, m.frames[0]);
    let transcript = null;
    try {
      await step("Listening to the words");
      transcript = await transcribe(blob, rec?.name || "video.mp4");
    } catch {}
    let notes = null;
    let by = "measurements only";
    const prov = chain("llm").find((p) => !p.offline);
    if (prov) {
      await step("AI is studying the video");
      try {
        const r = await prov.complete({ task: "research", tier: "quality", ...researchPrompt(m, transcript), images: m.frames, input: {} });
        notes = parseJson(r.text);
        by = prov.label;
      } catch (e) {
        const pe = toProviderError(e, prov.id);
        notes = { ...measuredNotes(m, transcript), aiError: friendly(pe, "research").message + " " + (pe.code === "missing_key" ? "The AI couldn't look at pictures here." : "") };
      }
    } else notes = measuredNotes(m, transcript);
    await patchRef(id, {
      status: "done", step: null, by,
      meta: { duration: m.duration, width: m.width, height: m.height, cuts: m.cuts, avgShot: m.avgShot, motion: m.motion },
      transcript: transcript?.text || null, notes,
    });
  } catch (e) {
    await patchRef(id, { status: "error", step: null, error: e.message || String(e) });
  } finally {
    researching.delete(id);
  }
}

/** Research of uploaded videos, condensed for prompts. */
function researchText(files) {
  const done = (files || []).filter((f) => f.status === "done" && f.notes);
  if (!done.length) return "";
  return (
    "Research on the user's uploaded reference videos (match this style, not the content):\n" +
    done
      .map((f, i) => {
        const n = f.notes;
        return `Video ${i + 1} (${Math.round(f.meta?.duration || 0)}s, new shot every ~${f.meta?.avgShot}s): ${[n.summary, n.hook && "Hook: " + n.hook, n.structure && "Structure: " + n.structure, n.pacing && "Pacing: " + n.pacing, n.visuals && "Visuals: " + n.visuals, n.captions && "Captions: " + n.captions, n.voice && "Voice: " + n.voice, n.copy?.length && "Copy: " + n.copy.join("; ")].filter(Boolean).join(" | ")}`;
      })
      .join("\n")
      .slice(0, 3500)
  );
}
function notesAsText(files) {
  return (files || [])
    .filter((f) => f.status === "done")
    .map((f) => {
      const n = f.notes || {};
      const row = (k, v) => (v ? `${k}: ${Array.isArray(v) ? v.map((x) => "\n  - " + x).join("") : v}\n` : "");
      return `# ${f.name}\n${row("Length", `${Math.round(f.meta?.duration || 0)} s, a new shot every ~${f.meta?.avgShot} s (${f.meta?.cuts} cuts), ${f.meta?.motion} motion`)}${row("Summary", n.summary)}${row("Hook", n.hook)}${row("Structure", n.structure)}${row("Pacing", n.pacing)}${row("Visuals", n.visuals)}${row("Captions", n.captions)}${row("Voice", n.voice)}${row("Music", n.music)}${row("What to copy", n.copy)}${f.transcript ? `Transcript: ${f.transcript}\n` : ""}Studied by: ${f.by}\n`;
    })
    .join("\n");
}
