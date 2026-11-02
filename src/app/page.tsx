"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ago, api, usePoll, useUi } from "@/components/ui";
import { detectFormat, parseCount } from "@/lib/formats/detect";

type F = { id: string; name: string; emoji: string; isDefault: boolean; lengthSec: number; description: string };
type Last = { formatId?: string; count?: number; lengthSec?: number; language?: string };

const EXAMPLES = [
  "Make 10 did-you-know shorts about the ocean.",
  "Make 5 top 5 list videos about budget travel hacks.",
  "Make 3 storytime shorts about a first day at a new job.",
];
const LANGS = ["English", "Korean", "Spanish", "Japanese", "Chinese", "Portuguese", "French", "German"];

const load = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) || "") ?? d;
  } catch {
    return d;
  }
};

export default function Home() {
  const router = useRouter();
  const { toast } = useUi();
  const [text, setText] = useState("");
  const [last, setLast] = useState<Last>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickStyle, setPickStyle] = useState(false);
  const { data: formats } = usePoll<F[]>("/api/formats", 0, false);
  const { data: health } = usePoll<{ offlineMode: boolean; ok: boolean }>("/api/health", 0, false);
  const { data: recent } = usePoll<any[]>("/api/projects", 0, false);

  // restore draft + remembered settings
  useEffect(() => {
    setText(load("cf-draft", ""));
    setLast(load("cf-last", {}));
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("cf-draft", JSON.stringify(text));
  }, [text, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem("cf-last", JSON.stringify(last));
  }, [last, ready]);

  const auto = !last.formatId || last.formatId === "auto" || !formats?.some((f) => f.id === last.formatId);
  const format = useMemo(
    () => (formats ? (auto ? detectFormat(text, formats) : formats.find((f) => f.id === last.formatId)) : undefined),
    [formats, last.formatId, auto, text],
  );
  const count = last.count || parseCount(text);
  const length = last.lengthSec || format?.lengthSec || 45;

  async function go() {
    if (!text.trim()) return toast("Type what you want to make first ✍️", true);
    setBusy(true);
    // so we can ping you when the videos are ready (only asks once)
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch {}
    try {
      const { id } = await api<{ id: string }>("/api/projects", {
        body: { request: text, formatId: auto ? "auto" : format?.id, count: last.count || null, lengthSec: last.lengthSec || null, language: last.language || "English" },
      });
      localStorage.removeItem("cf-draft");
      router.push(`/projects/${id}`);
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 className="pixel" style={{ fontSize: 24, lineHeight: 1.5, margin: "28px 0 18px" }}>
        What do you want to make?
      </h1>

      <textarea
        className="input big"
        placeholder={EXAMPLES[0]}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
        }}
        autoFocus
      />
      {!text && (
        <div className="chips" style={{ marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip small" onClick={() => setText(ex)} style={{ fontSize: 14 }}>
              💡 {ex.replace(/^Make /, "").slice(0, 48)}…
            </button>
          ))}
        </div>
      )}

      {/* one line by default; tap to change */}
      <div style={{ marginTop: 22 }} className="row">
        <span className="lbl" style={{ margin: 0 }}>Style:</span>
        <button className="chip on" onClick={() => setPickStyle(!pickStyle)} disabled={!formats}>
          {format ? `${format.emoji} ${format.name}` : "…"}
          {auto && <span className="small" style={{ opacity: 0.7 }}>&nbsp;(picked for you)</span>}
          <span className="small" style={{ opacity: 0.7 }}>&nbsp;{pickStyle ? "▴" : "Change ▾"}</span>
        </button>
      </div>
      {pickStyle && (
      <div style={{ marginTop: 12 }}>
        <div className="chips">
          {formats && (
            <button
              className={"chip" + (auto ? " on" : "")}
              onClick={() => {
                setLast({ ...last, formatId: "auto" });
                setPickStyle(false);
              }}
              title="Picks the style from what you typed"
            >
              ✨ Auto
            </button>
          )}
          {(formats || []).map((f) => (
            <button
              key={f.id}
              className={"chip" + (!auto && format?.id === f.id ? " on" : "")}
              onClick={() => {
                setLast({ ...last, formatId: f.id });
                setPickStyle(false);
              }}
              title={f.description}
            >
              {f.emoji} {f.name}
            </button>
          ))}
        </div>
        {format && <p className="small dim" style={{ margin: "8px 0 0" }}>{format.emoji} {format.name}: {format.description}</p>}
      </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary>More options</summary>
        <div className="card" style={{ display: "grid", gap: 18 }}>
          <div>
            <label className="lbl">How many videos?</label>
            <div className="chips">
              {[0, 1, 3, 5, 10, 20].map((n) => (
                <button key={n} className={"chip" + ((last.count || 0) === n ? " on" : "")} onClick={() => setLast({ ...last, count: n || undefined })}>
                  {n === 0 ? `Auto (${parseCount(text)})` : n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="lbl">How long?</label>
            <div className="chips">
              {[0, 30, 45, 60].map((n) => (
                <button key={n} className={"chip" + ((last.lengthSec || 0) === n ? " on" : "")} onClick={() => setLast({ ...last, lengthSec: n || undefined })}>
                  {n === 0 ? `Style default (${format?.lengthSec || 45}s)` : `${n} sec`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="lbl">Language</label>
            <select className="input" value={last.language || "English"} onChange={(e) => setLast({ ...last, language: e.target.value })}>
              {LANGS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {health?.offlineMode && (last.language || "English") !== "English" && (
              <p className="small dim">The offline robot voice only speaks English. Add a voice API key for other languages.</p>
            )}
          </div>
        </div>
      </details>

      {health?.offlineMode && (
        <div className="banner warn" style={{ marginTop: 18 }}>
          <span>🧪</span>
          <span className="small" style={{ flex: 1, minWidth: 200 }}>
            <b>Practice mode:</b> robot voice + simple title cards. Connect AI for real voices and pictures.
          </span>
          <Link href="/connect" className="btn small">
            🔌 Connect AI
          </Link>
        </div>
      )}

      <div className="gen-bar">
        <button className="btn primary huge" onClick={go} disabled={busy || !formats}>
          {busy ? <span className="spin">◐</span> : "GENERATE VIDEOS"}
        </button>
        <p className="dim small" style={{ textAlign: "center", marginTop: 10 }}>
          {count} video{count > 1 ? "s" : ""} · {format ? `${auto ? "✨ " : ""}${format.emoji} ${format.name}` : "…"} · about {length} sec each
          {last.language && last.language !== "English" ? ` · ${last.language}` : ""}
        </p>
      </div>

      {!!recent?.length && (
        <div style={{ marginTop: 40 }}>
          <h3 className="dim small" style={{ textTransform: "uppercase", letterSpacing: ".1em" }}>
            Continue
          </h3>
          <div style={{ display: "grid", gap: 10 }}>
            {recent.slice(0, 3).map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="card row" style={{ padding: 14 }}>
                <span style={{ fontSize: 24 }}>{p.format.emoji}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                <span className="small dim">
                  {p.done}/{p.total} done · {ago(p.createdAt)}
                </span>
                {p.problems > 0 && <span className="badge" style={{ color: "var(--red)" }}>needs help</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
