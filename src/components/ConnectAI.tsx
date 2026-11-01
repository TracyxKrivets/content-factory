"use client";
import { useEffect, useRef, useState } from "react";
import { api, usePoll, useUi } from "./ui";

type K = { name: string; label: string; unlocks: string; url: string; source: "app" | "env" | null; masked: string };

/** Paste any key → auto-detected → saved encrypted on the server → tested. */
export function ConnectAI({ onChange }: { onChange?: () => void }) {
  const { toast, confirm } = useUi();
  const { data: keys, reload } = usePoll<K[]>("/api/keys", 0, false);
  const [value, setValue] = useState("");
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  async function test(name: string) {
    setResults((r) => ({ ...r, [name]: { ok: true, message: "Checking…" } }));
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/keys/test", { body: { name } });
      setResults((x) => ({ ...x, [name]: r }));
    } catch (e: any) {
      setResults((x) => ({ ...x, [name]: { ok: false, message: e.message } }));
    }
  }

  // check every connected key once when the panel opens
  const tested = useRef(false);
  useEffect(() => {
    if (!keys || tested.current) return;
    tested.current = true;
    keys.filter((k) => k.source).forEach((k) => test(k.name));
  }, [keys]);

  async function save() {
    if (!value.trim()) return toast("Paste a key first", true);
    setBusy(true);
    try {
      const { name } = await api<{ name: string }>("/api/keys", { method: "PUT", body: { value, name: pick || undefined } });
      const label = keys?.find((k) => k.name === name)?.label || name;
      toast(`Saved ${label} ✓`);
      setValue("");
      setPick("");
      await reload();
      onChange?.();
      test(name);
    } catch (e: any) {
      toast(e.message, true);
      if (/couldn't tell/i.test(e.message)) setPick(keys?.[0]?.name || "");
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: K) {
    if (!(await confirm({ title: `Disconnect ${k.label}?`, body: "Videos will use the next available option.", yes: "Disconnect", danger: true }))) return;
    try {
      await api("/api/keys", { method: "PUT", body: { name: k.name, value: "" } });
      toast("Disconnected");
      reload();
      onChange?.();
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  return (
    <div className="card" id="connect" style={{ display: "grid", gap: 14 }}>
      <div>
        <label className="lbl">Paste an API key</label>
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 220, fontFamily: "monospace" }}
            placeholder="sk-ant-…  /  sk-…  /  pexels key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoComplete="off"
            spellCheck={false}
          />
          {pick && (
            <select className="input" style={{ width: "auto" }} value={pick} onChange={(e) => setPick(e.target.value)}>
              {keys?.map((k) => (
                <option key={k.name} value={k.name}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "SAVE KEY"}
          </button>
        </div>
        <p className="small dim" style={{ margin: "6px 0 0" }}>
          I&apos;ll figure out which service it&apos;s for. Keys are stored encrypted on the server and never shown again.
        </p>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {keys?.map((k) => (
          <div key={k.name} className="row" style={{ gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 20 }}>{!k.source ? "⚪" : results[k.name] && !results[k.name].ok ? "🔴" : "🟢"}</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <b>{k.label}</b> <span className="small dim">· {k.unlocks}</span>
              <div className="small dim">
                {k.source ? (
                  <>
                    <code>{k.masked}</code> {k.source === "env" ? "(from server settings)" : ""}
                  </>
                ) : (
                  <a href={k.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                    Get a key ↗
                  </a>
                )}
                {results[k.name] && (
                  <span style={{ marginLeft: 8, color: results[k.name].ok ? "var(--green)" : "var(--red)" }}>{results[k.name].message}</span>
                )}
              </div>
            </div>
            {k.source && (
              <button className="btn small" onClick={() => test(k.name)}>
                Test
              </button>
            )}
            {k.source === "app" && (
              <button className="btn small danger" onClick={() => remove(k)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
