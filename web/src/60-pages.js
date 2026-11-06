// ---------------------------------------------------------------- Make (home)
const EXAMPLES = [
  "Make 10 did-you-know shorts about the ocean.",
  "Make 5 top 5 list videos about budget travel hacks.",
  "Make 3 storytime shorts about a first day at a new job.",
];
const loadLS = (k, d) => {
  try {
    return JSON.parse(LS.getItem(k) || "null") ?? d;
  } catch {
    return d;
  }
};

function HomePage() {
  const [text, setText] = useState(() => loadLS("cf-draft", ""));
  const [last, setLast] = useState(() => loadLS("cf-last", {}));
  const [type, setType] = useState(() => loadLS("cf-type", ""));
  const [refs, setRefs] = useState(() => loadLS("cf-refs", {}));
  const [busy, setBusy] = useState(false);
  const recentTypes = loadLS("cf-types", []);
  const recent = useData(async () => (await db.all("projects")).filter((p) => !p.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 3));
  useEffect(() => LS.setItem("cf-draft", JSON.stringify(text)), [text]);
  useEffect(() => LS.setItem("cf-last", JSON.stringify(last)), [last]);
  useEffect(() => LS.setItem("cf-type", JSON.stringify(type)), [type]);
  useEffect(() => LS.setItem("cf-refs", JSON.stringify(refs)), [refs]);
  const count = last.count || parseCount(text);
  const practice = practiceMode();

  async function generate() {
    if (!text.trim()) return toast("Type what you want to make first ✍️", true);
    setBusy(true);
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch?.(() => {});
    } catch {}
    try {
      const links = String(refs.links || "").split(/\s+/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).slice(0, 10);
      const studied = (await refFiles()).filter((f) => f.status === "done").map(({ id, name, meta, notes, transcript, by }) => ({ id, name, meta, notes, transcript: transcript?.slice(0, 1500), by, status: "done" }));
      if ((await refFiles()).some((f) => f.status === "working" || f.status === "waiting") && !(await confirmBox({ title: "Still studying your videos", body: "Some reference videos aren't done yet. Start anyway without them, or wait a moment?", yes: "Start anyway" }))) {
        setBusy(false);
        return;
      }
      const p = await createProject({ request: text, contentType: type, count: last.count, lengthSec: last.lengthSec, language: last.language, refs: { links, note: (refs.note || "").trim(), files: studied } });
      LS.removeItem("cf-draft");
      if (type.trim()) LS.setItem("cf-types", JSON.stringify([type.trim(), ...recentTypes.filter((t) => t !== type.trim())].slice(0, 6)));
      go("project-" + p.id);
    } catch (e) {
      toast(e.message, true);
      setBusy(false);
    }
  }

  return html`<div style="max-width:760px;margin:0 auto">
    <h1 class="pixel" style="font-size:24px;line-height:1.5;margin:28px 0 18px">What do you want to make?</h1>
    <textarea class="input big" placeholder=${EXAMPLES[0]} value=${text} onInput=${(e) => setText(e.target.value)}
      onKeyDown=${(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && generate()} autofocus />
    ${!text && html`<div class="chips" style="margin-top:10px">${EXAMPLES.map((ex) => html`<button class="chip" style="font-size:14px" onClick=${() => setText(ex)}>💡 ${ex.replace(/^Make /, "").slice(0, 48)}…</button>`)}</div>`}

    <div style="margin-top:22px">
      <label class="lbl">What type of content? <span class="small dim">(optional: leave empty and I'll figure it out)</span></label>
      <input class="input" value=${type} placeholder="e.g. scary stories with a twist, fast facts, gym motivation, product reviews"
        onInput=${(e) => setType(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && generate()} />
      ${recentTypes.length > 0 && html`<div class="chips" style="margin-top:8px">${recentTypes.map((t) => html`<button class=${"chip" + (t === type ? " on" : "")} style="font-size:14px;min-height:40px" onClick=${() => setType(t === type ? "" : t)}>${t}</button>`)}</div>`}
    </div>

    <div class="opts">
      <div><label class="lbl">How many videos?</label><div class="chips">
        ${[0, 1, 3, 5, 10, 20].map((n) => html`<button class=${"chip" + ((last.count || 0) === n ? " on" : "")} onClick=${() => setLast({ ...last, count: n || undefined })}>${n === 0 ? `Auto (${parseCount(text)})` : n}</button>`)}
        <input class="input numbox" type="number" min="1" max="50" placeholder="Other" value=${[0, 1, 3, 5, 10, 20].includes(last.count || 0) ? "" : last.count}
          onInput=${(e) => setLast({ ...last, count: clamp(Number(e.target.value) || 0, 0, 50) || undefined })} />
      </div></div>
      <div><label class="lbl">How long is each video?</label><div class="chips">
        ${[0, 15, 30, 45, 60, 90].map((n) => html`<button class=${"chip" + ((last.lengthSec || 0) === n ? " on" : "")} onClick=${() => setLast({ ...last, lengthSec: n || undefined })}>${n === 0 ? "Auto" : n < 60 ? `${n} sec` : `${n / 60 === 1 ? "1 min" : "1.5 min"}`}</button>`)}
      </div></div>
      <div><label class="lbl">Language</label>
        <select class="input" value=${last.language || "English"} onChange=${(e) => setLast({ ...last, language: e.target.value })}>
          ${LANGUAGES.map(([en, native]) => html`<option value=${en}>${native === en ? en : `${native} (${en})`}</option>`)}</select>
        ${practice && (last.language || "English") !== "English" && html`<p class="small" style="margin:6px 0 0;color:#ffe0a0">Practice templates only write English. Connect an AI writer to make ${last.language} videos.</p>`}
      </div>
    </div>

    <div class="card refs" style="margin-top:22px">
      <label class="lbl" style="margin:0">🎞 Reference videos <span class="small dim">(optional: videos you're trying to make something like)</span></label>
      <div style="display:grid;gap:10px;margin-top:10px">
        <textarea class="input" rows="3" placeholder=${"Paste links, one per line\nhttps://www.tiktok.com/@creator/video/…\nhttps://youtube.com/shorts/…"} value=${refs.links || ""}
          onInput=${(e) => setRefs({ ...refs, links: e.target.value })} />
        <input class="input" placeholder="What should I copy from them? e.g. the fast cuts, the hook, the creepy tone, the caption style" value=${refs.note || ""}
          onInput=${(e) => setRefs({ ...refs, note: e.target.value })} />
        <${RefUploads} />
        <p class="small dim" style="margin:0">Links: the AI can't open them, so it goes by each link's title (when the site shares it) and your note. For real research, save the video and upload the file: the AI looks at its frames and studies the pacing.</p>
      </div>
    </div>

    ${practice && html`<div class="banner warn" style="margin-top:18px">
      <span>🧪</span><span class="small" style="flex:1;min-width:200px"><b>Practice mode:</b> template scripts, color backgrounds and no voice (text + music). Connect an AI writer for real scripts.</span>
      <a href="#connect" class="btn small">🔌 Connect AI</a>
    </div>`}

    <div class="gen-bar">
      <button class="btn primary huge" onClick=${generate} disabled=${busy}>${busy ? html`<span class="spin">◐</span>` : "GENERATE VIDEOS"}</button>
      <p class="dim small" style="text-align:center;margin-top:10px">${count} video${count > 1 ? "s" : ""}${type.trim() ? ` · ${type.trim().slice(0, 40)}` : ""}${last.lengthSec ? ` · ${last.lengthSec} sec each` : ""}${last.language && last.language !== "English" ? ` · ${last.language}` : ""}</p>
    </div>

    ${recent?.length > 0 && html`<div style="margin-top:40px">
      <h3 class="dim small" style="text-transform:uppercase;letter-spacing:.1em">Continue</h3>
      <div style="display:grid;gap:10px">${recent.map((p) => html`<a href=${"#project-" + p.id} class="card row" style="padding:14px">
        <span style="font-size:24px">${p.format.emoji}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title}</span>
        <span class="small dim">${STATUS[p.status]?.[0]} · ${ago(p.createdAt)}</span></a>`)}</div>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------- project
const STATUS = { planning: ["🧠 Planning", "var(--amber)"], generating: ["⚙️ Working", "var(--amber)"], done: ["✅ Done", "var(--green)"], needs_attention: ["⚠️ Needs a hand", "var(--red)"] };
const WORKERS = [
  { key: "writer", icon: "🧠", name: "Writer" }, { key: "voice", icon: "🎙", name: "Voice" }, { key: "visuals", icon: "👁", name: "Visuals" },
  { key: "captions", icon: "💬", name: "Captions" }, { key: "editor", icon: "🎬", name: "Editor" },
];
const WS_LABEL = { waiting: "Waiting", working: "Working", done: "Complete", error: "Error" };
function workerStatus(v, w) {
  const st = WORKER_STEPS[w].map((s) => v.steps[s].status);
  if (st.includes("error")) return "error";
  if (st.includes("working")) return "working";
  if (st.every((s) => s === "done" || s === "skipped")) return "done";
  if (st.some((s) => s === "done") && v.status === "working") return "working";
  return "waiting";
}
const STEP_WORDS = {
  script: "🧠 Writing the script…", script_check: "🧠 Checking the script…", scenes: "🧠 Planning scenes…", voice: "🎙 Recording voice…",
  visuals: "👁 Making visuals…", music: "🎵 Adding music…", captions: "💬 Timing captions…", assemble: "🎬 Editing the video…", final_check: "🎬 Final check…",
};

function ProjectPage({ id }) {
  const data = useData(async () => {
    const project = await db.get("projects", id);
    const videos = project ? (await db.byIndex("videos", "projectId", id)).sort((a, b) => a.index - b.index) : [];
    return { project, videos };
  }, [id]);
  const prev = useRef(null);
  useLive();
  useEffect(() => {
    const p = data?.project;
    if (!p) return;
    const done = data.videos.filter((v) => v.status === "done").length;
    document.title = ["generating", "planning"].includes(p.status) ? `(${done}/${data.videos.length || p.count}) Making videos…` : p.status === "done" ? "✅ Videos ready" : "⚠️ Needs a hand";
    if (prev.current && ["generating", "planning"].includes(prev.current) && ["done", "needs_attention"].includes(p.status)) {
      chime(p.status === "done");
      try {
        if (Notification.permission === "granted") new Notification(p.status === "done" ? "✅ Your videos are ready" : "⚠️ A video needs a hand", { body: p.title });
      } catch {}
    }
    prev.current = p.status;
  }, [data]);
  useEffect(() => () => (document.title = "Content Factory"), []);

  if (!data) return html`<div class="empty dim">Loading…</div>`;
  const { project: p, videos } = data;
  if (!p) return html`<div class="empty"><h2>This project doesn't exist anymore</h2><a href="#projects" class="btn">← All projects</a></div>`;
  const total = videos.length * STEPS.length || 1;
  const fin = videos.reduce((n, v) => n + STEPS.filter((s) => ["done", "skipped"].includes(v.steps[s].status)).length, 0);
  const pct = Math.round((fin / total) * 100);
  const doneV = videos.filter((v) => v.status === "done");
  const problems = videos.filter((v) => v.status === "needs_attention").length;
  const elapsed = (Date.now() - Date.parse(p.createdAt)) / 1000;
  const left = pct >= 8 && pct < 100 ? Math.max(1, Math.round((elapsed * (100 - pct)) / pct / 60)) : null;

  async function downloadAll() {
    toast("Packing the ZIP…");
    const files = {};
    let captions = `${p.title}\n${"=".repeat(p.title.length)}\n\n`;
    for (const [i, v] of doneV.entries()) {
      const n = String(i + 1).padStart(2, "0");
      const b = await blobs.get(v.steps.assemble.output.key);
      if (b) files[`${n}-${safeName(v.title)}.${v.steps.assemble.output.ext || "mp4"}`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
      const s = v.steps.script.output;
      captions += `${n}. ${v.title}\n${s?.caption || ""}\n${(s?.hashtags || []).join(" ")}\n\n`;
    }
    files["captions.txt"] = fflate.strToU8(captions);
    downloadBlob(new Blob([fflate.zipSync(files)], { type: "application/zip" }), safeName(p.title) + ".zip");
  }
  const copyAll = () =>
    copy(doneV.map((v, i) => `${i + 1}. ${v.title}\n${v.steps.script.output?.caption || ""}\n${(v.steps.script.output?.hashtags || []).join(" ")}`).join("\n\n"), `Copied ${doneV.length} caption${doneV.length > 1 ? "s" : ""} 📋`);

  return html`<div>
    <div style="margin-top:16px">
      <div class="row" style="gap:8px;margin-bottom:6px">
        <span class="badge">${p.format.emoji} ${p.format.name}</span><span class="saved">✓ Saved automatically</span>
        ${p.cost > 0 && html`<span class="badge">Cost so far ${money(p.cost)}</span>`}
        ${p.deletedAt && html`<span class="badge" style="color:var(--red)">In trash</span>`}
      </div>
      <h1 style="font-size:26px">${p.title}</h1>
      <p class="dim small" style="margin:0">“${p.request}”${p.language && p.language !== "English" ? ` · ${p.language}` : ""}</p>
      ${(p.refs?.links?.length > 0 || p.refs?.note || p.refs?.files?.length > 0) && html`<details style="margin-top:6px"><summary class="small" style="padding:4px 0">🎞 Reference videos (${p.refs.links.length + (p.refs.files?.length || 0)})</summary>
        <div class="small dim" style="display:grid;gap:4px">${p.refs.links.map((u, i) => html`<a href=${u} target="_blank" rel="noreferrer" style="text-decoration:underline;word-break:break-all">${p.refs.info?.[i]?.title || u}</a>`)}
        ${p.refs.note && html`<div>What to copy: ${p.refs.note}</div>`}
        ${(p.refs.files || []).map((f) => html`<div>🎬 ${f.name}: ${f.notes?.summary || ""}</div>`)}</div></details>`}
    </div>
    ${p.deletedAt && html`<div class="banner warn" style="margin-top:14px">This project is in the trash.
      <button class="btn small primary" onClick=${() => update("projects", id, { deletedAt: null })}>Restore it</button></div>`}
    ${!videos.length && !p.ideaError && html`<div class="card" style="margin-top:20px;text-align:center;padding:40px">
      <div style="font-size:48px" class="spin">🧠</div><h2 style="margin-top:12px">${p.styleReady ? `Coming up with ${p.count} video idea${p.count > 1 ? "s" : ""}…` : "Working out the style…"}</h2><p class="dim">This takes a few seconds.</p></div>`}
    ${p.ideaError && html`<div style="margin-top:20px"><${ErrorBox} err=${p.ideaError} onAction=${(a) => retryIdeas(id, a === "backup")} /></div>`}

    ${videos.length > 0 && html`
      <div class="card" style="margin-top:20px">
        <div class="workers">${WORKERS.map((w) => {
          const sts = videos.map((v) => workerStatus(v, w.key));
          const done = sts.filter((s) => s === "done").length;
          const s = sts.includes("error") ? "error" : sts.includes("working") ? "working" : done === videos.length ? "done" : "waiting";
          return html`<div class=${"worker " + s}><span class="ico">${w.icon}</span><div class="nm">${w.name}</div><div class=${"st st-" + s}>${WS_LABEL[s]}</div>${videos.length > 1 && html`<div class="small dim">${done}/${videos.length}</div>`}</div>`;
        })}</div>
        <div class="row" style="margin-top:14px"><div class="bar" style="flex:1"><div style=${`width:${pct}%`}></div></div><b class="small">${doneV.length}/${videos.length} ready</b></div>
        ${p.status === "generating" && html`<p class="small dim" style="margin:10px 0 0">${left ? `About ${left} min left. ` : ""}Keep this tab open while it works. If you close it, it picks up where it left off next time.</p>`}
        ${problems > 0 && p.status !== "generating" && html`<p class="small" style="margin:10px 0 0;color:#ffc9cb">${problems} video${problems > 1 ? "s need" : " needs"} a hand. Look for the red cards below.</p>`}
        ${p.status === "done" && html`<p class="small" style="margin:10px 0 0;color:var(--green)">🎉 All done!</p>`}
        ${doneV.length > 0 && html`<div class="row" style="margin-top:14px">
          <button class="btn primary" style="flex:2;min-width:220px" onClick=${downloadAll}>⬇ DOWNLOAD ALL ${doneV.length > 1 ? `(${doneV.length} videos)` : ""}</button>
          <button class="btn" style="flex:1;min-width:180px" onClick=${copyAll}>📋 Copy all captions</button></div>`}
      </div>
      <div class="grid" style="margin-top:20px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${videos.map((v) => html`<${VideoCard} key=${v.id} v=${v} />`)}</div>`}

    <div class="row" style="margin-top:30px">
      ${videos.length > 0 && !p.deletedAt && html`<button class="btn" onClick=${() => addVideos(id, 1)}>✚ 1 more video</button><button class="btn" onClick=${() => addVideos(id, 5)}>✚ 5 more</button>`}
      <span class="spacer"></span>
      ${!p.deletedAt && html`<button class="btn danger small" onClick=${async () => {
        if (!(await confirmBox({ title: "Move this project to the trash?", body: "You can restore it from Projects → Trash.", yes: "Move to trash", danger: true }))) return;
        await update("projects", id, { deletedAt: now() });
        queue.splice(0, queue.length, ...queue.filter((q) => !videos.some((v) => v.id === q)));
        go("projects");
      }}>🗑 Trash project</button>`}
    </div>
  </div>`;
}

function ErrorBox({ err, onAction, busy }) {
  return html`<div class="banner bad" style="flex-direction:column;align-items:stretch;gap:10px">
    <div><b>⚠️ ${err.message}</b><div class="small">${err.suggestion}</div></div>
    <div class="row">
      <button class="btn small primary" disabled=${busy} onClick=${() => onAction("retry")}>TRY AGAIN</button>
      ${err.canBackup && html`<button class="btn small" disabled=${busy} onClick=${() => onAction("backup")}>USE BACKUP</button>`}
      ${err.canSkip && html`<button class="btn small" disabled=${busy} onClick=${() => onAction("skip")}>SKIP</button>`}
    </div>
    <details><summary class="small">Advanced</summary><pre class="tech">${err.code}${err.provider ? " · " + err.provider : ""}\n${err.technical}</pre></details>
  </div>`;
}

const REDO = [
  ["voice", "🎙 New voice", "Re-record the narration"], ["visuals", "👁 New visuals", "New pictures, same script"],
  ["captions", "💬 Redo captions", "Re-time the captions"], ["scenes", "🎞 New scene ideas", "New picture prompts + visuals"],
  ["all", "🧠 Brand new script", "Start this video over"],
];
function VideoCard({ v }) {
  const [more, setMore] = useState(false);
  const [edit, setEdit] = useState(false);
  const finalKey = v.steps.assemble.status === "done" ? v.steps.assemble.output?.key : null;
  const imgKey = v.steps.visuals.output?.images?.[0] || v.steps.visuals.output?.partial?.[0]?.key;
  const videoUrl = useBlobUrl(finalKey);
  const imgUrl = useBlobUrl(imgKey);
  const errStep = STEPS.find((k) => v.steps[k].status === "error");
  const err = errStep && v.steps[errStep].error;
  const current = STEPS.find((k) => v.steps[k].status === "working");
  // "practice" only when the script itself came from templates (no voice / color backgrounds can be a choice)
  const practice = v.steps.script.provider === "offline-writer";
  const script = v.steps.script.output;
  const fname = `${safeName(v.title)}.${v.steps.assemble.output?.ext || "mp4"}`;
  const act = async (a, step) => {
    try {
      await videoAction(v.id, a, step);
      toast(a === "skip" ? "Skipped. Carrying on." : "On it 👍");
      setMore(false);
    } catch (e) {
      toast(e.message, true);
    }
  };
  const rp = live[v.id]?.render;
  return html`<div class=${"vcard" + (err ? " bad" : "")}>
    <div class="vframe">
      ${finalKey && videoUrl ? html`<video controls preload="metadata" playsinline src=${videoUrl} poster=${imgUrl || undefined}></video>` : html`
        ${imgUrl ? html`<img src=${imgUrl} style="opacity:.45" />` : html`<div class="pixel dim" style="font-size:34px">${err ? "⚠" : "…"}</div>`}
        <div style="position:absolute;top:14px;left:0;right:0;text-align:center" class="small">
          ${err ? "Needs a hand" : current ? STEP_WORDS[current] + (current === "assemble" && rp != null ? ` ${Math.round(rp * 100)}%` : "") : v.status === "queued" ? "In line…" : ""}</div>
        <div class="ministeps">${WORKERS.map((w) => html`<div class=${"ministep " + workerStatus(v, w.key)} title=${w.name}>${w.icon}</div>`)}</div>`}
    </div>
    <div class="vbody">
      <div style="font-weight:700;line-height:1.3">${v.title}</div>
      ${practice && html`<div><span class="badge offline" title="The script came from practice templates. Connect an AI writer for real scripts.">🧪 Practice quality</span></div>`}
      ${err && html`<${ErrorBox} err=${err} onAction=${(a) => act(a, errStep)} />`}
      ${finalKey && html`<button class="btn primary" onClick=${async () => downloadBlob(await blobs.get(finalKey), fname)}>⬇ DOWNLOAD</button>`}
      <div class="row" style="gap:6px;flex-wrap:nowrap">
        ${script && html`<button class="btn small tight" onClick=${() => setEdit(true)}>✏️ Edit</button>`}
        ${finalKey && script && html`<button class="btn small tight" onClick=${() => copy(`${script.caption}\n\n${script.hashtags.join(" ")}`, "Caption copied 📋")}>📋 Copy</button>`}
        <button class="btn small tight" onClick=${() => setMore(true)}>⋯ More</button>
      </div>
    </div>
    ${more && html`<${Modal} onClose=${() => setMore(false)}>
      <h2>${v.title}</h2><p class="dim small">Redo just one part. Everything else stays.</p>
      <div style="display:grid;gap:10px">
        ${REDO.map(([step, label, hint]) => html`<button class="btn" style="justify-content:space-between" disabled=${step !== "all" && v.steps[step].status === "working"}
          onClick=${async () => {
            if (step === "all" && !(await confirmBox({ title: "Start this video over?", body: "The script, voice and visuals for this video will be replaced.", yes: "Yes, start over", danger: true }))) return;
            act("regenerate", step);
          }}><span>${label}</span><span class="small dim">${hint}</span></button>`)}
        <button class="btn" style="justify-content:space-between" onClick=${async () => (await duplicateVideo(v.id), toast("Copied ✓"), setMore(false))}><span>📄 Duplicate</span><span class="small dim">Make a copy to tweak</span></button>
      </div>
      <details style="margin-top:12px"><summary class="small">Advanced: what made this</summary>
        <pre class="tech">${STEPS.map((k) => `${k.padEnd(13)} ${v.steps[k].status.padEnd(8)} ${v.steps[k].provider || ""}`).join("\n")}${v.steps.assemble.output?.codec ? `\n\nvideo: ${v.steps.assemble.output.codec}, ${(v.steps.assemble.output.size / 1e6).toFixed(1)} MB` : ""}</pre></details>
      <button class="btn" style="width:100%;margin-top:14px" onClick=${() => setMore(false)}>Close</button>
    <//>`}
    ${edit && html`<${EditModal} v=${v} onClose=${() => setEdit(false)} />`}
  </div>`;
}

function EditModal({ v, onClose }) {
  const s = v.steps.script.output;
  const [title, setTitle] = useState(s.title);
  const [lines, setLines] = useState(s.lines.join("\n"));
  const [caption, setCaption] = useState(s.caption);
  const save = async () => {
    try {
      await editScript(v.id, { title, lines: lines.split("\n"), caption });
      toast("Saved. Rebuilding the video 🎬");
      onClose();
    } catch (e) {
      toast(e.message, true);
    }
  };
  return html`<${Modal} onClose=${onClose}>
    <h2>✏️ Edit script</h2>
    <label class="lbl">Title</label><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} />
    <label class="lbl" style="margin-top:14px">What it says <span class="dim small">(one line = one scene)</span></label>
    <textarea class="input" style="min-height:260px" value=${lines} onInput=${(e) => setLines(e.target.value)} />
    <label class="lbl" style="margin-top:14px">Post caption</label><input class="input" value=${caption} onInput=${(e) => setCaption(e.target.value)} />
    <p class="small dim">Same number of lines keeps your visuals. The voice and video are rebuilt.</p>
    <div class="row"><button class="btn" style="flex:1" onClick=${onClose}>Cancel</button><button class="btn primary" style="flex:2" onClick=${save}>SAVE & REBUILD</button></div>
  <//>`;
}

// ---------------------------------------------------------------- projects list
function ProjectsPage() {
  const [trash, setTrash] = useState(false);
  const data = useData(async () => {
    const ps = (await db.all("projects")).filter((p) => (trash ? !!p.deletedAt : !p.deletedAt)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const vs = await db.all("videos");
    return ps.map((p) => {
      const mine = vs.filter((v) => v.projectId === p.id);
      return { ...p, total: Math.max(p.count, mine.length), done: mine.filter((v) => v.status === "done").length, thumb: mine.find((v) => v.steps.visuals.output?.images?.[0])?.steps.visuals.output.images[0] };
    });
  }, [trash]);
  return html`<div>
    <div class="row" style="margin-top:16px"><h1>${trash ? "🗑 Trash" : "📁 Projects"}</h1><span class="spacer"></span>
      ${trash && data?.length > 0 && html`<button class="btn small danger" onClick=${async () => {
        if (await confirmBox({ title: "Empty the trash?", body: "These projects and their videos are deleted for good. This frees up space in your browser.", yes: "Delete forever", danger: true })) {
          await emptyTrash();
          toast("Trash emptied");
        }
      }}>Empty trash</button>`}
      <button class="btn small" onClick=${() => setTrash(!trash)}>${trash ? "← Back to projects" : "🗑 Trash"}</button>
      ${!trash && html`<a href="#make" class="btn primary small">✚ New</a>`}
    </div>
    ${data?.length === 0 && html`<div class="empty"><p class="dim">${trash ? "Trash is empty." : "No projects yet."}</p>${!trash && html`<a href="#make" class="btn primary">Make your first videos</a>`}</div>`}
    <div class="grid" style="margin-top:10px">${(data || []).map((p) => html`<${ProjectRow} p=${p} trash=${trash} />`)}</div>
  </div>`;
}
function ProjectRow({ p, trash }) {
  const thumb = useBlobUrl(p.thumb);
  return html`<div class="card" style="display:flex;gap:14px;padding:14px">
    <a href=${"#project-" + p.id} style="width:72px;flex:none"><div style="aspect-ratio:9/16;background:#05070f;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:28px">
      ${thumb ? html`<img src=${thumb} style="width:100%;height:100%;object-fit:cover" />` : p.format.emoji}</div></a>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
      <a href=${"#project-" + p.id} style="font-weight:700;line-height:1.3">${p.title}</a>
      <span class="small" style=${"color:" + STATUS[p.status]?.[1]}>${STATUS[p.status]?.[0]} · ${p.done}/${p.total} videos</span>
      <span class="small dim">${p.format.emoji} ${p.format.name} · ${ago(p.createdAt)}</span>
      ${trash && html`<button class="btn small primary" onClick=${async () => (await update("projects", p.id, { deletedAt: null }), toast("Restored ✓"))}>♻️ Restore</button>`}
    </div></div>`;
}

// ---------------------------------------------------------------- connect AI (grouped by job)
const KEY_LINKS = Object.fromEntries(KEY_DEFS.map((d) => [d.name, d.url]));
const ROLES = [
  {
    id: "writer", icon: "🧠", title: "Writer", what: "Writes the ideas, scripts and style.", models: true,
    options: [
      { id: "claude-account", label: "Your Claude account", note: "Uses your Claude plan, no key. Only when the app is open inside Claude.", claude: true },
      { id: "anthropic", label: "Claude API (Anthropic)", note: "Pay per use with an API key.", key: "ANTHROPIC_API_KEY" },
      { id: "openai", label: "OpenAI API", note: "Pay per use with an API key.", key: "OPENAI_API_KEY" },
      { id: "offline-writer", label: "Practice templates", note: "Free. Basic fill-in-the-blank scripts." },
    ],
  },
  {
    id: "voice", icon: "🎙", title: "Voice", what: "Reads the script out loud.",
    options: [
      { id: "elevenlabs", label: "ElevenLabs", note: "The most natural voices.", key: "ELEVENLABS_API_KEY" },
      { id: "openai-tts", label: "OpenAI voice", note: "Good and cheap.", key: "OPENAI_API_KEY" },
      { id: "no-voice", label: "No voice (text + music)", note: "Free. Big captions over music." },
    ],
  },
  {
    id: "visuals", icon: "👁", title: "Visuals", what: "Makes the picture for each scene.",
    options: [
      { id: "openai-image", label: "OpenAI images", note: "AI pictures, about $0.10 each.", key: "OPENAI_API_KEY" },
      { id: "pexels", label: "Pexels photos", note: "Free stock photos.", key: "PEXELS_API_KEY" },
      { id: "offline-cards", label: "Color backgrounds", note: "Free." },
    ],
  },
  {
    id: "captions", icon: "💬", title: "Caption timing", what: "Times the words on screen.",
    options: [
      { id: "estimated", label: "Estimated", note: "Free. Good enough for most videos." },
      { id: "openai-whisper", label: "OpenAI exact timing", note: "Matches the voice word for word.", key: "OPENAI_API_KEY" },
    ],
  },
  {
    id: "chat", icon: "🛠", title: "Change-the-app chat", what: "Fixes, adds or removes features when you ask.", models: true,
    options: [
      { id: "claude-account", label: "Your Claude account", note: "Uses your Claude plan, no key. Only inside Claude.", claude: true },
      { id: "anthropic", label: "Claude API (Anthropic)", note: "Pay per use with an API key.", key: "ANTHROPIC_API_KEY" },
      { id: "openai", label: "OpenAI API", note: "Pay per use with an API key.", key: "OPENAI_API_KEY" },
    ],
  },
];
function optionState(o) {
  const C = CLAUDE();
  if (o.claude) {
    if (!C.inClaude) return { ok: false, why: "Open the app inside Claude to use this." };
    if (C.declined) return { ok: false, why: "Not allowed. Reload and press Allow when Claude asks." };
    if (!C.sample) return { ok: false, why: "Connecting to Claude…" };
    return { ok: true };
  }
  if (o.key) {
    if (!canFetch()) return { ok: false, why: "Not available inside Claude. Use the downloaded-file version for this." };
    return keys.get(o.key) ? { ok: true } : { ok: false, why: "Needs a key", needsKey: true };
  }
  return { ok: true };
}

function ConnectPage() {
  useData(async () => keys.all()); // re-render when keys change
  const [roles, setRoles] = useState(() => loadSetting("cf-roles", {}));
  const [models, setModels] = useState(() => loadSetting("cf-models", {}));
  const [results, setResults] = useState({});
  const tested = useRef(false);
  const test = async (name) => {
    setResults((r) => ({ ...r, [name]: { ok: true, message: "Checking…" } }));
    const r = await testKey(name, keys.get(name));
    setResults((x) => ({ ...x, [name]: r }));
  };
  useEffect(() => {
    if (tested.current || !canFetch()) return;
    tested.current = true;
    KEY_DEFS.filter((d) => keys.get(d.name)).forEach((d) => test(d.name));
  }, []);
  const choose = (role, id) => {
    const next = { ...roles, [role]: id };
    setRoles(next);
    saveSetting("cf-roles", next);
  };
  const setModel = (role, m) => {
    const next = { ...models, [role]: m };
    setModels(next);
    saveSetting("cf-models", next);
  };
  const C = CLAUDE();
  return html`<div style="max-width:820px;margin:0 auto">
    <h1 style="margin-top:16px">🔌 Connect AI</h1>
    <p class="dim" style="margin-top:0">Pick what does each job. Anything not set up falls back to the free option, so the app always works.
      ${C.inClaude ? " You're inside Claude, so the Writer and the chat can run on your Claude account with no key." : " Keys stay in this browser and go straight to each service."}</p>
    ${C.inClaude && html`<div class="banner warn" style="margin-bottom:14px"><span class="small">Inside Claude, the page can't reach outside services (ElevenLabs, OpenAI, Pexels), so voice and AI pictures are off here. For those, use the downloaded-file version of the app.</span></div>`}
    <div style="display:grid;gap:16px">${ROLES.map((role) => {
      const states = role.options.map((o) => ({ o, st: optionState(o) }));
      const auto = states.find((x) => x.st.ok)?.o.id;
      const sel = roles[role.id] && states.find((x) => x.o.id === roles[role.id]) ? roles[role.id] : auto;
      const selected = states.find((x) => x.o.id === sel);
      const usingFallback = roles[role.id] && roles[role.id] !== sel;
      return html`<div class="card">
        <div class="row" style="margin-bottom:4px"><span style="font-size:26px">${role.icon}</span><div style="flex:1"><b style="font-size:18px">${role.title}</b><div class="small dim">${role.what}</div></div></div>
        <div style="display:grid;gap:8px;margin-top:10px">${states.map(({ o, st }) => html`<${RoleOption} o=${o} st=${st} on=${o.id === sel} onPick=${() => choose(role.id, o.id)} result=${o.key && results[o.key]} onTest=${() => test(o.key)} />`)}</div>
        ${role.models && selected && (selected.o.id === "claude-account" || selected.o.id === "anthropic") && html`<div style="margin-top:12px"><label class="lbl small">Claude model</label>
          <div class="chips">${CLAUDE_MODELS.map(([m, label, hint]) => html`<button class=${"chip" + ((models[role.id] || "claude-sonnet-5-5") === m ? " on" : "")} title=${hint} onClick=${() => setModel(role.id, m)}>${label} <span class="small" style="opacity:.7">${hint}</span></button>`)}</div></div>`}
        ${usingFallback && html`<p class="small" style="margin:10px 0 0;color:#ffe0a0">Your pick isn't ready yet, so “${selected?.o.label}” is used for now.</p>`}
      </div>`;
    })}</div>
    <button class="btn primary" style="width:100%;margin-top:18px" onClick=${() => go("make")}>DONE: MAKE VIDEOS</button>
  </div>`;
}

function RoleOption({ o, st, on, onPick, result, onTest }) {
  const [val, setVal] = useState("");
  const has = o.key && keys.get(o.key);
  const save = () => {
    if (!val.trim()) return toast("Paste the key first", true);
    keys.set(o.key, val);
    setVal("");
    toast("Key saved ✓");
    onPick();
    setTimeout(onTest, 50);
  };
  return html`<div class=${"roleopt" + (on ? " on" : "") + (st.ok ? "" : " off")}>
    <button class="roleopt-main" onClick=${onPick}>
      <span class="radio">${on ? "●" : "○"}</span>
      <span style="flex:1;text-align:left"><b>${o.label}</b><span class="small dim"> · ${o.note}</span>
        ${!st.ok && !st.needsKey && html`<div class="small" style="color:#ffe0a0">${st.why}</div>`}</span>
    </button>
    ${o.key && canFetch() && html`<div class="row" style="gap:8px;margin:8px 0 0 34px">
      ${has
        ? html`<code class="small dim">${mask(has)}</code>
            ${result && html`<span class="small" style=${"color:" + (result.ok ? "var(--green)" : "var(--red)")}>${result.message}</span>`}
            <span class="spacer"></span>
            <button class="btn small" onClick=${onTest}>Test</button>
            <button class="btn small danger" onClick=${async () => {
              if (await confirmBox({ title: "Remove this key?", body: "Anything using it falls back to the next option.", yes: "Remove", danger: true })) keys.set(o.key, "");
            }}>✕</button>`
        : html`<input class="input" style="flex:1;min-width:200px;font-family:monospace;padding:10px 12px" placeholder="Paste key" value=${val}
              onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && save()} autocomplete="off" spellcheck="false" />
            <button class="btn small primary" onClick=${save}>Save key</button>
            <a class="small" href=${KEY_LINKS[o.key]} target="_blank" rel="noreferrer" style="text-decoration:underline">Get a key ↗</a>`}
    </div>`}
  </div>`;
}

async function testKey(name, value) {
  const calls = {
    // browsers may only call the messages endpoint; a 1-token reply costs a tiny fraction of a cent
    ANTHROPIC_API_KEY: () =>
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": value, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: MODELS.anthropic.cheap, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      }),
    OPENAI_API_KEY: () => fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${value}` } }),
    ELEVENLABS_API_KEY: () => fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": value } }),
    PEXELS_API_KEY: () => fetch("https://api.pexels.com/v1/search?query=night&per_page=1", { headers: { Authorization: value } }),
  };
  try {
    const res = await calls[name]();
    if (res.ok) return { ok: true, message: "Connected ✓" };
    if (res.status === 401 || res.status === 403) return { ok: false, message: "That key was rejected. Copy it again and paste the whole thing." };
    if (res.status === 429) return { ok: true, message: "Key works (service is busy right now)." };
    return { ok: false, message: `The service answered with an error (${res.status}). Try again in a minute.` };
  } catch {
    return { ok: false, message: "Couldn't reach the service. Check your internet." };
  }
}

// ---------------------------------------------------------------- system
function SystemPage() {
  const errs = useData(async () => (await kv.get("errors", [])).filter((e) => !e.resolved));
  const info = useData(async () => {
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    const codecs = typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" ? await pickCodecs() : null;
    const ps = await db.all("projects");
    return { est, persisted, codecs, cost: ps.reduce((s, p) => s + (p.cost || 0), 0) };
  });
  const titles = useData(async () => Object.fromEntries((await db.all("projects")).map((p) => [p.id, p.title])));
  const act = async (e, action) => {
    try {
      if (action !== "resolve") {
        if (e.step === "ideas") await retryIdeas(e.projectId, action === "backup");
        else if (e.videoId) {
          const v = await db.get("videos", e.videoId);
          if (v?.steps[e.step]?.status === "error") await videoAction(e.videoId, action, e.step);
        }
      }
      const list = await kv.get("errors", []);
      for (const x of list) if (x.id === e.id) x.resolved = true;
      await kv.set("errors", list);
      toast(action === "resolve" ? "Dismissed" : "On it 👍");
    } catch (er) {
      toast(er.message, true);
    }
  };
  const editor = info?.codecs?.video && info?.codecs?.audio;
  const checks = info && [
    { name: "Video editor", ok: !!editor || typeof MediaRecorder !== "undefined", msg: editor ? `Fast MP4 export (${info.codecs.video[1].toUpperCase()} + ${info.codecs.audio[1].toUpperCase()}).` : "Slow mode: this browser records videos in real time. Chrome or Edge is faster." },
    { name: "Storage", ok: true, msg: info.est ? `Using ${(info.est.usage / 1e6).toFixed(0)} MB of ${(info.est.quota / 1e9).toFixed(1)} GB available.` : "Saving in this browser." },
    { name: "Keep my projects", ok: info.persisted, msg: info.persisted ? "Your browser won't clear your projects." : "Your browser may clear projects if it runs low on space.", fix: !info.persisted },
  ];
  return html`<div>
    <h1 style="margin-top:16px">⚙ System</h1>
    ${errs && html`<div class=${"banner " + (errs.length ? "warn" : "good")}><b>${errs.length ? `⚠️ ${errs.length} problem(s) need a look.` : "✅ Everything is working."}</b></div>`}
    <div class="row" style="margin-top:28px"><h2 style="margin:0">🚑 Error Center</h2><span class="spacer"></span>
      ${errs?.length > 0 && html`<button class="btn small primary" onClick=${async () => { for (const e of errs) await act(e, "retry"); }}>Retry all</button>`}</div>
    ${errs?.length === 0 && html`<p class="dim">No problems. Nice.</p>`}
    <div style="display:grid;gap:12px;margin-top:12px">${(errs || []).map((e) => html`<div class="card">
      <div class="row" style="align-items:flex-start"><div style="flex:1;min-width:240px"><b>⚠️ ${e.error.message}</b><div class="small">${e.error.suggestion}</div>
        <div class="small dim" style="margin-top:4px">${titles?.[e.projectId] || "App"} · ${ago(e.createdAt)} ${e.projectId && html`· <a href=${"#project-" + e.projectId} style="text-decoration:underline">open project</a>`}</div></div>
        <div class="row" style="gap:8px"><button class="btn small primary" onClick=${() => act(e, "retry")}>TRY AGAIN</button>
          ${e.error.canBackup && html`<button class="btn small" onClick=${() => act(e, "backup")}>USE BACKUP</button>`}
          ${e.error.canSkip && html`<button class="btn small" onClick=${() => act(e, "skip")}>SKIP</button>`}
          <button class="btn small" title="Hide" onClick=${() => act(e, "resolve")}>✕</button></div></div>
      <details><summary class="small">Advanced</summary><pre class="tech">step: ${e.step} · code: ${e.error.code}${e.error.provider ? " · provider: " + e.error.provider : ""}\n${e.error.technical}</pre></details>
    </div>`)}</div>
    ${checks && html`<h2 style="margin-top:34px">🩺 Health</h2><div class="grid">
      ${checks.map((c) => html`<div class="card"><b>${c.ok ? "✅" : "⚠️"} ${c.name}</b><div class="small dim">${c.msg}</div>
        ${c.fix && html`<button class="btn small" style="margin-top:8px" onClick=${async () => {
          const ok = await navigator.storage?.persist?.();
          toast(ok ? "Your projects are protected ✓" : "Your browser said no. Bookmarking this page usually helps.", !ok);
          changed();
        }}>Protect my projects</button>`}</div>`)}
      <div class="card"><b>💸 Spend (estimate)</b><div class="small dim">${money(info.cost)} total</div></div>
      <div class="card"><b>🔌 AI</b><div class="small dim">${practiceMode() ? "Practice mode: connect an AI writer for real scripts." : "Connected."}</div><a href="#connect" class="btn small" style="margin-top:8px">Choose AI for each job</a></div>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------- reference video uploads (Make page)
function RefUploads() {
  const files = useData(refFiles) || [];
  const [drag, setDrag] = useState(false);
  const input = useRef();
  const add = async (list) => {
    const n = await addRefFiles(list);
    if (n) toast(`Studying ${n} video${n > 1 ? "s" : ""}… 🔍`);
  };
  const ai = !practiceMode();
  return html`<div>
    <div class=${"dropzone" + (drag ? " on" : "")}
      onClick=${() => input.current?.click()}
      onDragOver=${(e) => (e.preventDefault(), setDrag(true))} onDragLeave=${() => setDrag(false)}
      onDrop=${(e) => (e.preventDefault(), setDrag(false), add([...e.dataTransfer.files]))}>
      <div style="font-size:26px">⬆</div>
      <b>Upload reference videos</b>
      <div class="small dim">Drop video files here or tap to choose (MP4 works best${files.length ? `, ${MAX_REF_FILES - files.length} more allowed` : `, up to ${MAX_REF_FILES}`})</div>
      <input ref=${input} type="file" accept="video/*,.mp4,.mov,.webm,.m4v" multiple style="display:none" onChange=${(e) => {
        const picked = [...e.target.files]; // copy first: clearing the box empties its live file list
        e.target.value = "";
        add(picked);
      }} />
    </div>
    ${!ai && html`<p class="small" style="margin:8px 0 0;color:#ffe0a0">No AI writer connected, so I can only measure the videos (length, cuts, pace). Connect one to have it study them properly.</p>`}
    ${files.length > 0 && html`<div style="display:grid;gap:10px;margin-top:12px">${files.map((f) => html`<${RefCard} key=${f.id} f=${f} />`)}</div>`}
    ${files.some((f) => f.status === "done") && html`<button class="btn small" style="margin-top:10px" onClick=${() => downloadBlob(new Blob([notesAsText(files)], { type: "text/plain" }), "reference-research.txt")}>⬇ Download research notes</button>`}
  </div>`;
}
function RefCard({ f }) {
  const [open, setOpen] = useState(false);
  const [play, setPlay] = useState(false);
  const thumb = useBlobUrl(f.status === "done" ? "refthumb:" + f.id : null);
  const vid = useBlobUrl(play ? "ref:" + f.id : null);
  const n = f.notes || {};
  const row = (k, v) => v && html`<div><b>${k}:</b> ${Array.isArray(v) ? html`<ul style="margin:4px 0 0;padding-left:18px">${v.map((x) => html`<li>${x}</li>`)}</ul>` : v}</div>`;
  return html`<div class="refcard">
    <div class="row" style="gap:12px;align-items:flex-start;flex-wrap:nowrap">
      <div class="refthumb" onClick=${() => f.status === "done" && setPlay(!play)} title="Play">
        ${play && vid ? html`<video src=${vid} controls autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>` : thumb ? html`<img src=${thumb} />` : html`<span>🎬</span>`}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</div>
        <div class="small dim">${(f.size / 1e6).toFixed(1)} MB${f.meta ? ` · ${Math.round(f.meta.duration)} s · new shot every ~${f.meta.avgShot} s` : ""}</div>
        ${f.status === "waiting" && html`<div class="small" style="color:var(--amber)">In line…</div>`}
        ${f.status === "working" && html`<div class="small" style="color:var(--amber)"><span class="spin">◐</span> ${f.step || "Studying"}…</div>`}
        ${f.status === "error" && html`<div class="small" style="color:var(--red)">⚠️ ${f.error} <button class="btn small" style="min-height:32px;padding:4px 10px" onClick=${() => researchRef(f.id)}>Try again</button></div>`}
        ${f.status === "done" && html`<div class="small" style="margin-top:2px">${n.summary || ""}</div>
          ${n.aiError && html`<div class="small" style="color:#ffe0a0">${n.aiError}</div>`}
          <button class="btn small" style="min-height:32px;padding:4px 10px;margin-top:6px" onClick=${() => setOpen(!open)}>${open ? "Hide notes" : "See what the AI learned"}</button>`}
      </div>
      <button class="btn small danger" style="min-height:36px;padding:4px 10px" title="Remove" onClick=${async () => {
        if (await confirmBox({ title: "Remove this reference video?", yes: "Remove", danger: true })) removeRefFile(f.id);
      }}>✕</button>
    </div>
    ${open && html`<div class="small refnotes">
      ${row("Hook", n.hook)}${row("Structure", n.structure)}${row("Pacing", n.pacing)}${row("Visuals", n.visuals)}${row("Captions", n.captions)}${row("Voice", n.voice)}${row("Music", n.music)}${row("What to copy", n.copy)}
      ${f.transcript && html`<details><summary class="small">Transcript</summary><div class="dim">${f.transcript}</div></details>`}
      <div class="dim" style="margin-top:6px">Studied by: ${f.by}</div>
      <button class="btn small" style="margin-top:8px" onClick=${() => researchRef(f.id)}>↻ Study again</button>
    </div>`}
  </div>`;
}
