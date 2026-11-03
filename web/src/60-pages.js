// ---------------------------------------------------------------- Make (home)
const EXAMPLES = [
  "Make 10 did-you-know shorts about the ocean.",
  "Make 5 top 5 list videos about budget travel hacks.",
  "Make 3 storytime shorts about a first day at a new job.",
];
const LANGS = ["English", "Korean", "Spanish", "Japanese", "Chinese", "Portuguese", "French", "German"];
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
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const formats = useData(listFormats);
  const recent = useData(async () => (await db.all("projects")).filter((p) => !p.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 3));
  useEffect(() => LS.setItem("cf-draft", JSON.stringify(text)), [text]);
  useEffect(() => LS.setItem("cf-last", JSON.stringify(last)), [last]);
  const auto = !last.formatId || last.formatId === "auto" || !formats?.some((f) => f.id === last.formatId);
  const format = formats ? (auto ? detectFormat(text, formats) : formats.find((f) => f.id === last.formatId)) : null;
  const count = last.count || parseCount(text);
  const length = last.lengthSec || format?.lengthSec || 40;
  const practice = practiceMode();

  async function generate() {
    if (!text.trim()) return toast("Type what you want to make first ✍️", true);
    setBusy(true);
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch?.(() => {});
    } catch {}
    try {
      const p = await createProject({ request: text, formatId: auto ? "auto" : format?.id, count: last.count, lengthSec: last.lengthSec, language: last.language });
      LS.removeItem("cf-draft");
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

    <div class="row" style="margin-top:22px">
      <span class="lbl" style="margin:0">Style:</span>
      <button class="chip on" onClick=${() => setPick(!pick)} disabled=${!formats}>
        ${format ? `${format.emoji} ${format.name}` : "…"}
        ${auto && html`<span class="small" style="opacity:.7"> (picked for you)</span>`}
        <span class="small" style="opacity:.7"> ${pick ? "▴" : "Change ▾"}</span>
      </button>
    </div>
    ${pick && html`<div style="margin-top:12px"><div class="chips">
      <button class=${"chip" + (auto ? " on" : "")} onClick=${() => (setLast({ ...last, formatId: "auto" }), setPick(false))}>✨ Auto</button>
      ${formats.map((f) => html`<button class=${"chip" + (!auto && format?.id === f.id ? " on" : "")} title=${f.description}
        onClick=${() => (setLast({ ...last, formatId: f.id }), setPick(false))}>${f.emoji} ${f.name}</button>`)}
    </div>${format && html`<p class="small dim" style="margin:8px 0 0">${format.emoji} ${format.name}: ${format.description}</p>`}</div>`}

    <details style="margin-top:16px"><summary>More options</summary>
      <div class="card" style="display:grid;gap:18px">
        <div><label class="lbl">How many videos?</label><div class="chips">
          ${[0, 1, 3, 5, 10, 20].map((n) => html`<button class=${"chip" + ((last.count || 0) === n ? " on" : "")} onClick=${() => setLast({ ...last, count: n || undefined })}>${n === 0 ? `Auto (${parseCount(text)})` : n}</button>`)}
        </div></div>
        <div><label class="lbl">How long?</label><div class="chips">
          ${[0, 30, 45, 60].map((n) => html`<button class=${"chip" + ((last.lengthSec || 0) === n ? " on" : "")} onClick=${() => setLast({ ...last, lengthSec: n || undefined })}>${n === 0 ? `Style default (${format?.lengthSec || 40}s)` : `${n} sec`}</button>`)}
        </div></div>
        <div><label class="lbl">Language</label>
          <select class="input" value=${last.language || "English"} onChange=${(e) => setLast({ ...last, language: e.target.value })}>${LANGS.map((l) => html`<option>${l}</option>`)}</select>
        </div>
      </div>
    </details>

    ${practice && html`<div class="banner warn" style="margin-top:18px">
      <span>🧪</span><span class="small" style="flex:1;min-width:200px"><b>Practice mode:</b> template scripts, color backgrounds and no voice (text + music). Connect AI for real scripts, voices and pictures.</span>
      <a href="#connect" class="btn small">🔌 Connect AI</a>
    </div>`}

    <div class="gen-bar">
      <button class="btn primary huge" onClick=${generate} disabled=${busy || !formats}>${busy ? html`<span class="spin">◐</span>` : "GENERATE VIDEOS"}</button>
      <p class="dim small" style="text-align:center;margin-top:10px">${count} video${count > 1 ? "s" : ""} · ${format ? `${auto ? "✨ " : ""}${format.emoji} ${format.name}` : "…"} · about ${length} sec each${last.language && last.language !== "English" ? ` · ${last.language}` : ""}</p>
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
      <p class="dim small" style="margin:0">“${p.request}”</p>
    </div>
    ${p.deletedAt && html`<div class="banner warn" style="margin-top:14px">This project is in the trash.
      <button class="btn small primary" onClick=${() => update("projects", id, { deletedAt: null })}>Restore it</button></div>`}
    ${!videos.length && !p.ideaError && html`<div class="card" style="margin-top:20px;text-align:center;padding:40px">
      <div style="font-size:48px" class="spin">🧠</div><h2 style="margin-top:12px">Coming up with ${p.count} video ideas…</h2><p class="dim">This takes a few seconds.</p></div>`}
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
  const practice = Object.values(v.steps).some((s) => String(s.provider || "").split(", ").some((id) => PRACTICE_IDS.has(id)));
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
      ${practice && html`<div><span class="badge offline" title="Made with practice tools. Connect AI for full quality.">🧪 Practice quality</span></div>`}
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

// ---------------------------------------------------------------- formats
const CAPTIONS = [["bold-yellow", "Bold yellow"], ["clean-white", "Clean white"], ["red-highlight", "Red highlight"], ["glitch", "Glitch"]];
const MUSIC = [["chill-pad", "Chill"], ["upbeat-pulse", "Upbeat"], ["tense-pulse", "Dramatic"], ["dark-drone", "Dark"], ["eerie-tone", "Eerie"], ["none", "No music"]];
function FormatsPage() {
  const data = useData(listFormats);
  const [editing, setEditing] = useState(null);
  return html`<div>
    <div class="row" style="margin-top:16px"><h1>📜 Formats</h1><span class="spacer"></span>
      <button class="btn primary small" onClick=${async () => setEditing(await createFormat())}>✚ New format</button></div>
    <p class="dim" style="margin-top:0">Reusable recipes: hook, structure, look, voice, captions and music.</p>
    <div class="grid">${(data || []).map((f) => html`<div class="card" style=${"display:flex;flex-direction:column;gap:10px" + (f.isDefault ? ";border-color:var(--amber)" : "")}>
      <div class="row"><span style="font-size:30px">${f.emoji}</span><div style="flex:1"><b>${f.name}</b>${f.isDefault && html`<div class="small" style="color:var(--amber)">★ Default</div>`}</div></div>
      <p class="small dim" style="margin:0;flex:1">${f.description}</p>
      <div class="small dim">${f.lengthSec}s · ${CAPTIONS.find((c) => c[0] === f.captionStyle)?.[1] || "Bold yellow"} captions · ${MUSIC.find((m) => m[0] === f.musicStyle)?.[1] || "Chill"}</div>
      <div class="row" style="gap:8px"><button class="btn small" style="flex:1" onClick=${() => setEditing(f)}>✏️ Edit</button>
        ${!f.isDefault && html`<button class="btn small" style="flex:1" onClick=${async () => (await setDefaultFormat(f.id), toast("Default set ★"))}>★ Default</button>`}</div>
      <div class="row" style="gap:8px">
        <button class="btn small" style="flex:1" onClick=${async () => (await createFormat({ ...f, name: f.name + " (copy)" }), toast("Copied ✓"))}>📄 Duplicate</button>
        <button class="btn small danger" style="flex:1" onClick=${async () => {
          if (await confirmBox({ title: `Delete “${f.name}”?`, body: "Projects already made with it are not affected.", yes: "Delete", danger: true })) (await deleteFormat(f.id), toast("Deleted"));
        }}>🗑 Delete</button></div>
    </div>`)}</div>
    <button class="btn small" style="margin-top:24px" onClick=${async () => (await restoreStarters(), toast("Starter formats restored"))}>♻️ Bring back missing starter formats</button>
    ${editing && html`<${FormatEditor} f=${editing} onClose=${() => setEditing(null)} />`}
  </div>`;
}
function FormatEditor({ f, onClose }) {
  const [v, setV] = useState(f);
  const [state, setState] = useState("saved");
  const first = useRef(true);
  const timer = useRef();
  useEffect(() => {
    if (first.current) return void (first.current = false);
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await update("formats", f.id, cleanFormat(v));
      setState("saved");
    }, 500);
  }, [v]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const field = (k, label, hint, rows = 2) => html`<div><label class="lbl">${label} <span class="small dim">${hint}</span></label><textarea class="input" rows=${rows} value=${v[k] || ""} onInput=${set(k)} /></div>`;
  const chips = (k, opts) => html`<div class="chips">${opts.map(([val, l]) => html`<button class=${"chip" + (String(v[k]) === String(val) ? " on" : "")} onClick=${() => setV({ ...v, [k]: val })}>${l}</button>`)}</div>`;
  return html`<${Modal} onClose=${onClose}>
    <div class="row"><h2 style="margin:0">Edit format</h2><span class="spacer"></span><span class="saved" style=${state === "saving" ? "color:var(--amber)" : ""}>${state === "saved" ? "✓ Saved" : "Saving…"}</span></div>
    <div style="display:grid;gap:14px;margin-top:14px">
      <div class="row" style="align-items:flex-end"><div style="width:80px"><label class="lbl">Icon</label><input class="input" value=${v.emoji} maxlength="4" onInput=${set("emoji")} style="text-align:center;font-size:22px" /></div>
        <div style="flex:1"><label class="lbl">Name</label><input class="input" value=${v.name} onInput=${set("name")} /></div></div>
      ${field("description", "What is it?", "one line")}${field("hookStyle", "Hook", "how the first line grabs")}${field("structure", "Story structure", "beat by beat", 3)}
      ${field("visualStyle", "Look", "what the pictures look like")}${field("voiceStyle", "Voice", "how the narrator sounds", 1)}
      <div><label class="lbl">Captions</label>${chips("captionStyle", CAPTIONS)}</div>
      <div><label class="lbl">Background music</label>${chips("musicStyle", MUSIC)}</div>
      <div><label class="lbl">Length</label>${chips("lengthSec", [20, 30, 45, 60, 90].map((n) => [n, n + "s"]))}</div>
    </div>
    <button class="btn primary" style="width:100%;margin-top:18px" onClick=${onClose}>DONE</button>
  <//>`;
}

// ---------------------------------------------------------------- connect AI
function ConnectPage() {
  const k = useData(async () => keys.all());
  const [value, setValue] = useState("");
  const [pick, setPick] = useState("");
  const [results, setResults] = useState({});
  const tested = useRef(false);
  const test = async (name) => {
    setResults((r) => ({ ...r, [name]: { ok: true, message: "Checking…" } }));
    const r = await testKey(name, keys.get(name));
    setResults((x) => ({ ...x, [name]: r }));
  };
  useEffect(() => {
    if (!k || tested.current) return;
    tested.current = true;
    KEY_DEFS.filter((d) => k[d.name]).forEach((d) => test(d.name));
  }, [k]);
  const save = () => {
    const name = pick || detectKey(value);
    if (!value.trim()) return toast("Paste a key first", true);
    if (!name) {
      setPick(KEY_DEFS[0].name);
      return toast("I couldn't tell which service that's for. Pick it from the list, then save.", true);
    }
    keys.set(name, value);
    setValue("");
    setPick("");
    toast(`Saved ${KEY_DEFS.find((d) => d.name === name).label} ✓`);
    test(name);
  };
  return html`<div style="max-width:760px;margin:0 auto">
    <h1 style="margin-top:16px">🔌 Connect AI</h1>
    <p class="dim" style="margin-top:0">Paste a key from any of these. <b>One is enough to start</b>; more means better voices and pictures. Without keys it still works in practice mode.</p>
    <div class="card" style="margin-bottom:16px"><b>Quickest setup:</b>
      <ol class="small" style="margin:6px 0 0;padding-left:20px;line-height:1.8">
        <li>Click <b>Get a key ↗</b> next to a service and create a key on their site.</li>
        <li>Copy it, paste it below and press <b>SAVE KEY</b>.</li><li>Green dot = working. Go make videos.</li></ol></div>
    <div class="card" style="display:grid;gap:14px">
      <div><label class="lbl">Paste an API key</label>
        <div class="row">
          <input class="input" style="flex:1;min-width:220px;font-family:monospace" placeholder="sk-ant-…  /  sk-…  /  pexels key" value=${value}
            onInput=${(e) => setValue(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && save()} autocomplete="off" spellcheck="false" />
          ${pick && html`<select class="input" style="width:auto" value=${pick} onChange=${(e) => setPick(e.target.value)}>${KEY_DEFS.map((d) => html`<option value=${d.name}>${d.label}</option>`)}</select>`}
          <button class="btn primary" onClick=${save}>SAVE KEY</button>
        </div>
        <p class="small dim" style="margin:6px 0 0">I'll figure out which service it's for. Keys stay in this browser only and go straight to that service.</p>
      </div>
      ${KEY_DEFS.map((d) => {
        const has = k?.[d.name];
        const r = results[d.name];
        return html`<div class="row" style="gap:10px;padding:8px 0;border-top:1px solid var(--line)">
          <span style="font-size:20px">${!has ? "⚪" : r && !r.ok ? "🔴" : "🟢"}</span>
          <div style="flex:1;min-width:180px"><b>${d.label}</b> <span class="small dim">· ${d.unlocks}</span>
            <div class="small dim">${has ? html`<code>${mask(has)}</code>` : html`<a href=${d.url} target="_blank" rel="noreferrer" style="text-decoration:underline">Get a key ↗</a>`}
              ${r && html`<span style=${"margin-left:8px;color:" + (r.ok ? "var(--green)" : "var(--red)")}>${r.message}</span>`}</div></div>
          ${has && html`<button class="btn small" onClick=${() => test(d.name)}>Test</button>
            <button class="btn small danger" onClick=${async () => {
              if (await confirmBox({ title: `Disconnect ${d.label}?`, body: "Videos will use the next available option.", yes: "Disconnect", danger: true })) keys.set(d.name, "");
            }}>✕</button>`}
        </div>`;
      })}
    </div>
    <a href="#make" class="btn primary" style="width:100%;margin-top:18px">DONE: MAKE VIDEOS</a>
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
      <div class="card"><b>🔌 AI</b><div class="small dim">${practiceMode() ? "Practice mode: connect AI for full quality." : "Connected."}</div><a href="#connect" class="btn small" style="margin-top:8px">Manage AI keys</a></div>
    </div>`}
    <details style="margin-top:20px"><summary>Advanced: provider order</summary>
      <p class="small dim">Top = tried first. If it fails, the next one is used automatically.</p>
      <${ProviderOrder} />
    </details>
  </div>`;
}
function ProviderOrder() {
  const [order, setOrder] = useState(() => loadLS("cf-order", {}));
  useData(async () => keys.all());
  const CAPS = { llm: "🧠 Writer", voice: "🎙 Voice", image: "👁 Visuals", captions: "💬 Captions" };
  return html`<div style="display:grid;gap:14px">${Object.entries(REGISTRY).map(([cap, list]) => {
    const saved = order[cap] || [];
    const sorted = [...list].sort((a, b) => (saved.indexOf(a.id) < 0 ? 99 : saved.indexOf(a.id)) - (saved.indexOf(b.id) < 0 ? 99 : saved.indexOf(b.id)));
    return html`<div class="card"><b>${CAPS[cap]}</b><div style="display:grid;gap:6px;margin-top:8px">${sorted.map((p, i) => html`<div class="row" style="gap:8px">
      <span class="dim" style="width:22px">${i + 1}.</span><span style="flex:1">${p.available() ? "🟢" : "⚪"} ${p.label}${p.offline ? html` <span class="badge offline">practice</span>` : ""}</span>
      <button class="btn small" disabled=${i === 0} onClick=${() => {
        const ids = sorted.map((x) => x.id);
        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
        const next = { ...order, [cap]: ids };
        setOrder(next);
        LS.setItem("cf-order", JSON.stringify(next));
        toast("Saved ✓");
      }}>↑</button></div>`)}</div></div>`;
  })}</div>`;
}
