"use client";
import { useState } from "react";
import type { FriendlyError, StepName, StepState, Video, WorkerName } from "@/lib/types";
import { WORKER_STEPS } from "@/lib/types";
import { api, fileUrl, Modal, useUi } from "./ui";

export const WORKERS: { key: WorkerName; icon: string; name: string }[] = [
  { key: "writer", icon: "🧠", name: "Writer" },
  { key: "voice", icon: "🎙", name: "Voice" },
  { key: "visuals", icon: "👁", name: "Visuals" },
  { key: "captions", icon: "💬", name: "Captions" },
  { key: "editor", icon: "🎬", name: "Editor" },
];
type WS = "waiting" | "working" | "done" | "error";
const LABEL: Record<WS, string> = { waiting: "Waiting", working: "Working", done: "Complete", error: "Error" };

export function workerStatus(v: Video, w: WorkerName, queued = v.status === "queued"): WS {
  const st = WORKER_STEPS[w].map((s) => v.steps[s].status);
  if (st.includes("error")) return "error";
  if (st.includes("working")) return "working";
  if (st.every((s) => s === "done" || s === "skipped")) return "done";
  // a worker is "working" between its steps (e.g. writer after script, before scenes)
  if (!queued && st.some((s) => s === "done") && v.status === "working") return "working";
  return "waiting";
}

export function WorkerStrip({ videos }: { videos: Video[] }) {
  return (
    <div className="workers">
      {WORKERS.map((w) => {
        const sts = videos.map((v) => workerStatus(v, w.key));
        const done = sts.filter((s) => s === "done").length;
        const s: WS = sts.includes("error") ? "error" : sts.includes("working") ? "working" : videos.length && done === videos.length ? "done" : "waiting";
        return (
          <div key={w.key} className={"worker " + s}>
            <span className="ico">{w.icon}</span>
            <div className="nm">{w.name}</div>
            <div className={"st st-" + s}>{LABEL[s]}</div>
            {videos.length > 1 && (
              <div className="small dim">
                {done}/{videos.length}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ErrorBox({ err, onAction, busy }: { err: FriendlyError; onAction: (a: "retry" | "backup" | "skip") => void; busy?: boolean }) {
  return (
    <div className="banner bad" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <div>
        <b>⚠️ {err.message}</b>
        <div className="small">{err.suggestion}</div>
      </div>
      <div className="row">
        <button className="btn small primary" disabled={busy} onClick={() => onAction("retry")}>
          TRY AGAIN
        </button>
        {err.canBackup && (
          <button className="btn small" disabled={busy} onClick={() => onAction("backup")}>
            USE BACKUP
          </button>
        )}
        {err.canSkip && (
          <button className="btn small" disabled={busy} onClick={() => onAction("skip")}>
            SKIP
          </button>
        )}
      </div>
      <details>
        <summary className="small">Advanced</summary>
        <pre className="tech">
          {err.code}
          {err.provider ? ` · ${err.provider}` : ""}
          {"\n"}
          {err.technical}
        </pre>
      </details>
    </div>
  );
}

const REDO: { step: StepName | "all"; label: string; hint: string }[] = [
  { step: "voice", label: "🎙 New voice", hint: "Re-record the narration" },
  { step: "visuals", label: "👁 New visuals", hint: "New pictures, same script" },
  { step: "captions", label: "💬 Redo captions", hint: "Re-time the captions" },
  { step: "music", label: "🎵 New background sound", hint: "" },
  { step: "scenes", label: "🎞 New scene ideas", hint: "New picture prompts + visuals" },
  { step: "all", label: "🧠 Brand new script", hint: "Start this video over" },
];

export function VideoCard({
  v,
  labels,
  onChange,
}: {
  v: Video;
  labels: Record<string, { label: string; offline: boolean }>;
  onChange: () => void;
}) {
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [edit, setEdit] = useState(false);
  const final = v.steps.assemble.status === "done" && v.steps.assemble.output?.key;
  const img = v.steps.visuals.output?.images?.[0] || v.steps.visuals.output?.partial?.[0]?.key;
  const errStep = (Object.keys(v.steps) as StepName[]).find((k) => v.steps[k].status === "error");
  const err = errStep ? v.steps[errStep].error : undefined;
  const offline = [...new Set(Object.values(v.steps).flatMap((s: StepState) => String(s.provider || "").split(", ")))]
    .filter((p) => labels[p]?.offline)
    .map((p) => labels[p].label);
  const current = (Object.keys(v.steps) as StepName[]).find((k) => v.steps[k].status === "working");

  async function act(action: "retry" | "backup" | "skip" | "regenerate", step?: StepName | "all") {
    setBusy(true);
    try {
      await api(`/api/videos/${v.id}`, { body: { action, step } });
      toast(action === "skip" ? "Skipped. Carrying on." : "On it 👍");
      setMore(false);
      onChange();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  async function dup() {
    setBusy(true);
    try {
      await api(`/api/videos/${v.id}/duplicate`, { body: {} });
      toast("Copied ✓");
      setMore(false);
      onChange();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const script = v.steps.script.output;
  const fileName = `${(v.title || "video").replace(/[^\w]+/g, "-").slice(0, 50)}.mp4`;

  return (
    <div className={"vcard" + (err ? " bad" : "")}>
      <div className="vframe">
        {final ? (
          <video controls preload="metadata" playsInline src={fileUrl(v.steps.assemble.output.key)} poster={img ? fileUrl(img) : undefined} />
        ) : (
          <>
            {img ? <img src={fileUrl(img)} alt="" style={{ opacity: 0.45 }} /> : <div className="pixel dim" style={{ fontSize: 34 }}>{err ? "⚠" : "…"}</div>}
            {!final && (
              <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center" }} className="small">
                {err ? "Needs a hand" : current ? stepWords(current) : v.status === "queued" ? "In line…" : ""}
              </div>
            )}
            <div className="ministeps">
              {WORKERS.map((w) => (
                <div key={w.key} className={"ministep " + workerStatus(v, w.key)} title={w.name}>
                  {w.icon}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="vbody">
        <div style={{ fontWeight: 700, lineHeight: 1.3 }}>{v.title}</div>
        {offline.length > 0 && (
          <div>
            <span className="badge offline" title={"Made with: " + offline.join(", ")}>
              🧪 Practice quality
            </span>
          </div>
        )}
        {err && errStep && <ErrorBox err={err} busy={busy} onAction={(a) => act(a, errStep)} />}
        {final && (
          <a className="btn primary" href={fileUrl(v.steps.assemble.output.key, fileName)} download={fileName}>
            ⬇ DOWNLOAD
          </a>
        )}
        <div className="row" style={{ gap: 8 }}>
          {script && (
            <button className="btn small" style={{ flex: 1 }} onClick={() => setEdit(true)} disabled={busy}>
              ✏️ Edit
            </button>
          )}
          <button className="btn small" style={{ flex: 1 }} onClick={() => setMore(true)} disabled={busy}>
            ⋯ More
          </button>
        </div>
      </div>

      {more && (
        <Modal onClose={() => setMore(false)}>
          <h2>{v.title}</h2>
          <p className="dim small">Redo just one part. Everything else stays.</p>
          <div style={{ display: "grid", gap: 10 }}>
            {REDO.map((r) => (
              <button
                key={r.step}
                className="btn"
                style={{ justifyContent: "space-between" }}
                disabled={busy || (r.step !== "all" && v.steps[r.step as StepName].status === "working")}
                onClick={async () => {
                  if (r.step === "all" && !(await confirm({ title: "Start this video over?", body: "The current script, voice and visuals for this video will be replaced.", yes: "Yes, start over", danger: true })))
                    return;
                  act("regenerate", r.step);
                }}
              >
                <span>{r.label}</span>
                <span className="small dim">{r.hint}</span>
              </button>
            ))}
            <button className="btn" onClick={dup} disabled={busy} style={{ justifyContent: "space-between" }}>
              <span>📄 Duplicate</span>
              <span className="small dim">Make a copy to tweak</span>
            </button>
            {script && (
              <button
                className="btn"
                style={{ justifyContent: "space-between" }}
                onClick={() => {
                  navigator.clipboard.writeText(`${script.caption}\n\n${script.hashtags.join(" ")}`);
                  toast("Caption copied 📋");
                }}
              >
                <span>📋 Copy post caption</span>
                <span className="small dim">For TikTok / Reels</span>
              </button>
            )}
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="small">Advanced: what made this</summary>
            <pre className="tech">
              {(Object.keys(v.steps) as StepName[])
                .map((k) => `${k.padEnd(13)} ${v.steps[k].status.padEnd(8)} ${v.steps[k].provider ? labels[v.steps[k].provider!]?.label || v.steps[k].provider : ""}${v.steps[k].cost ? ` $${v.steps[k].cost!.toFixed(4)}` : ""}`)
                .join("\n")}
              {v.steps.script_check.output?.issues?.length ? `\n\nQuality notes: ${v.steps.script_check.output.issues.join("; ")}` : ""}
            </pre>
          </details>
          <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={() => setMore(false)}>
            Close
          </button>
        </Modal>
      )}
      {edit && script && <EditModal v={v} onClose={() => setEdit(false)} onSaved={onChange} />}
    </div>
  );
}

function stepWords(s: StepName) {
  return (
    {
      script: "🧠 Writing the script…",
      script_check: "🧠 Checking the script…",
      scenes: "🧠 Planning scenes…",
      voice: "🎙 Recording voice…",
      visuals: "👁 Making visuals…",
      music: "🎵 Adding sound…",
      captions: "💬 Timing captions…",
      assemble: "🎬 Editing the video…",
      final_check: "🎬 Final check…",
    } as Record<StepName, string>
  )[s];
}

function EditModal({ v, onClose, onSaved }: { v: Video; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUi();
  const s = v.steps.script.output;
  const [title, setTitle] = useState(s.title);
  const [lines, setLines] = useState((s.lines as string[]).join("\n"));
  const [caption, setCaption] = useState(s.caption);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/videos/${v.id}`, { method: "PATCH", body: { title, lines: lines.split("\n"), caption } });
      toast("Saved. Rebuilding the video 🎬");
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose}>
      <h2>✏️ Edit script</h2>
      <label className="lbl">Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="lbl" style={{ marginTop: 14 }}>
        What the narrator says <span className="dim small">(one line = one scene)</span>
      </label>
      <textarea className="input" style={{ minHeight: 260 }} value={lines} onChange={(e) => setLines(e.target.value)} />
      <label className="lbl" style={{ marginTop: 14 }}>
        Post caption
      </label>
      <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} />
      <p className="small dim">Same number of lines keeps your visuals. The voice and video are rebuilt.</p>
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" style={{ flex: 2 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "SAVE & REBUILD"}
        </button>
      </div>
    </Modal>
  );
}
