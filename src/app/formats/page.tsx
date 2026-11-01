"use client";
import { useEffect, useRef, useState } from "react";
import { api, Modal, usePoll, useUi } from "@/components/ui";
import type { Format } from "@/lib/types";

const CAPTIONS: [Format["captionStyle"], string][] = [
  ["bold-yellow", "Bold yellow"],
  ["clean-white", "Clean white"],
  ["horror-red", "Horror red"],
  ["glitch", "Glitch"],
];
const MUSIC: [Format["musicStyle"], string][] = [
  ["dark-drone", "Dark drone"],
  ["eerie-tone", "Eerie tone"],
  ["tense-pulse", "Tense pulse"],
  ["none", "No music"],
];

export default function Formats() {
  const { toast, confirm } = useUi();
  const { data, reload } = usePoll<Format[]>("/api/formats", 0, false);
  const [editing, setEditing] = useState<Format | null>(null);

  async function call(url: string, method: string, body?: any, msg?: string) {
    try {
      const r = await api(url, { method, body: body ?? {} });
      if (msg) toast(msg);
      reload();
      return r;
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginTop: 16 }}>
        <h1>📜 Formats</h1>
        <span className="spacer" />
        <button
          className="btn primary small"
          onClick={async () => {
            const f = await call("/api/formats", "POST", { name: "My Format" });
            if (f) setEditing(f as Format);
          }}
        >
          ✚ New format
        </button>
      </div>
      <p className="dim" style={{ marginTop: 0 }}>Reusable recipes: hook, structure, look, voice, captions and music.</p>

      <div className="grid">
        {data?.map((f) => (
          <div key={f.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, borderColor: f.isDefault ? "var(--amber)" : undefined }}>
            <div className="row">
              <span style={{ fontSize: 30 }}>{f.emoji}</span>
              <div style={{ flex: 1 }}>
                <b>{f.name}</b>
                {f.isDefault && (
                  <div className="small" style={{ color: "var(--amber)" }}>
                    ★ Default
                  </div>
                )}
              </div>
            </div>
            <p className="small dim" style={{ margin: 0, flex: 1 }}>{f.description}</p>
            <div className="small dim">
              {f.lengthSec}s · {CAPTIONS.find((c) => c[0] === f.captionStyle)?.[1]} captions · {MUSIC.find((m) => m[0] === f.musicStyle)?.[1]}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" style={{ flex: 1 }} onClick={() => setEditing(f)}>
                ✏️ Edit
              </button>
              {!f.isDefault && (
                <button className="btn small" style={{ flex: 1 }} onClick={() => call(`/api/formats/${f.id}`, "PATCH", { isDefault: true }, "Default set ★")}>
                  ★ Default
                </button>
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" style={{ flex: 1 }} onClick={() => call(`/api/formats/${f.id}`, "POST", {}, "Copied ✓")}>
                📄 Duplicate
              </button>
              <button
                className="btn small danger"
                style={{ flex: 1 }}
                onClick={async () => {
                  if (await confirm({ title: `Delete “${f.name}”?`, body: "Projects already made with it are not affected.", yes: "Delete", danger: true }))
                    call(`/api/formats/${f.id}`, "DELETE", undefined, "Deleted");
                }}
              >
                🗑 Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn small" style={{ marginTop: 24 }} onClick={() => call("/api/formats/restore", "POST", {}, "Starter formats restored")}>
        ♻️ Bring back missing starter formats
      </button>

      {editing && (
        <FormatEditor
          f={editing}
          onClose={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Autosaves as you type. */
function FormatEditor({ f, onClose }: { f: Format; onClose: () => void }) {
  const [v, setV] = useState(f);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const timer = useRef<any>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api(`/api/formats/${f.id}`, { method: "PATCH", body: v });
        setState("saved");
      } catch {
        setState("error");
      }
    }, 600);
  }, [v, f.id]);
  const set = (k: keyof Format) => (e: any) => setV({ ...v, [k]: e.target.value });
  const field = (k: keyof Format, label: string, hint: string, rows = 2) => (
    <div>
      <label className="lbl">
        {label} <span className="small dim">{hint}</span>
      </label>
      <textarea className="input" rows={rows} value={String(v[k] ?? "")} onChange={set(k)} />
    </div>
  );
  return (
    <Modal onClose={onClose}>
      <div className="row">
        <h2 style={{ margin: 0 }}>Edit format</h2>
        <span className="spacer" />
        <span className="saved" style={{ color: state === "error" ? "var(--red)" : state === "saving" ? "var(--amber)" : undefined }}>
          {state === "saved" ? "✓ Saved" : state === "saving" ? "Saving…" : "Couldn't save"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 80 }}>
            <label className="lbl">Icon</label>
            <input className="input" value={v.emoji} maxLength={4} onChange={set("emoji")} style={{ textAlign: "center", fontSize: 22 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="lbl">Name</label>
            <input className="input" value={v.name} onChange={set("name")} />
          </div>
        </div>
        {field("description", "What is it?", "one line", 2)}
        {field("hookStyle", "Hook", "how the first line grabs", 2)}
        {field("structure", "Story structure", "beat by beat", 3)}
        {field("visualStyle", "Look", "what the pictures look like", 2)}
        {field("voiceStyle", "Voice", "how the narrator sounds", 1)}
        <div>
          <label className="lbl">Captions</label>
          <div className="chips">
            {CAPTIONS.map(([k, l]) => (
              <button key={k} className={"chip" + (v.captionStyle === k ? " on" : "")} onClick={() => setV({ ...v, captionStyle: k })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="lbl">Background sound</label>
          <div className="chips">
            {MUSIC.map(([k, l]) => (
              <button key={k} className={"chip" + (v.musicStyle === k ? " on" : "")} onClick={() => setV({ ...v, musicStyle: k })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="lbl">Length</label>
          <div className="chips">
            {[20, 30, 45, 60, 90].map((n) => (
              <button key={n} className={"chip" + (Number(v.lengthSec) === n ? " on" : "")} onClick={() => setV({ ...v, lengthSec: n })}>
                {n}s
              </button>
            ))}
          </div>
        </div>
      </div>
      <button className="btn primary" style={{ width: "100%", marginTop: 18 }} onClick={onClose} disabled={state === "saving"}>
        DONE
      </button>
    </Modal>
  );
}
