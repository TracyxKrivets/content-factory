"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ago, api, money, usePoll, useUi } from "@/components/ui";

const CAP: Record<string, string> = { llm: "🧠 Writer", voice: "🎙 Voice", image: "👁 Visuals", captions: "💬 Captions", music: "🎵 Music" };

export default function System() {
  const { toast, confirm } = useUi();
  const { data: h, reload: reloadH } = usePoll<any>("/api/health", 5000);
  const { data: errs, reload: reloadE } = usePoll<any[]>("/api/errors", 5000);
  const [order, setOrder] = useState<Record<string, string[]>>({});
  useEffect(() => {
    api("/api/settings").then((s) => setOrder(s.providerOrder || {})).catch(() => {});
  }, []);

  async function errAction(id: string, action: string) {
    try {
      await api(`/api/errors/${id}`, { body: { action } });
      toast(action === "resolve" ? "Dismissed" : "On it 👍");
      reloadE();
      reloadH();
    } catch (e: any) {
      toast(e.message, true);
    }
  }
  async function retryAll() {
    if (!errs?.length) return;
    if (!(await confirm({ title: `Retry all ${errs.length} problems?`, yes: "Retry all" }))) return;
    for (const e of errs) await api(`/api/errors/${e.id}`, { body: { action: "retry" } }).catch(() => {});
    toast("Retrying everything 👍");
    reloadE();
  }
  async function saveOrder(cap: string, ids: string[]) {
    const next = { ...order, [cap]: ids };
    setOrder(next);
    try {
      await api("/api/settings", { method: "PUT", body: { providerOrder: next } });
      toast("Saved ✓");
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 16 }}>⚙ System</h1>
      {!h && <p className="dim">Checking…</p>}
      {h && (
        <div className={"banner " + (h.ok && !h.openErrors ? "good" : h.ok ? "warn" : "bad")}>
          <b>{h.ok && !h.openErrors ? "✅ Everything is working." : h.ok ? `⚠️ ${h.openErrors} problem(s) need a look.` : "❌ Something important is broken."}</b>
        </div>
      )}

      {/* Error center */}
      <div className="row" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>🚑 Error Center</h2>
        <span className="spacer" />
        {!!errs?.length && (
          <button className="btn small primary" onClick={retryAll}>
            Retry all
          </button>
        )}
      </div>
      {errs?.length === 0 && <p className="dim">No problems. Nice.</p>}
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {errs?.map((e) => (
          <div key={e.id} className="card">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <b>⚠️ {e.error.message}</b>
                <div className="small">{e.error.suggestion}</div>
                <div className="small dim" style={{ marginTop: 4 }}>
                  {e.videoTitle || e.projectTitle || "App"} · {ago(e.createdAt)}
                  {e.projectId && (
                    <>
                      {" · "}
                      <Link href={`/projects/${e.projectId}`} style={{ textDecoration: "underline" }}>
                        open project
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn small primary" onClick={() => errAction(e.id, "retry")}>
                  TRY AGAIN
                </button>
                {e.error.canBackup && (
                  <button className="btn small" onClick={() => errAction(e.id, "backup")}>
                    USE BACKUP
                  </button>
                )}
                {e.error.canSkip && (
                  <button className="btn small" onClick={() => errAction(e.id, "skip")}>
                    SKIP
                  </button>
                )}
                <button className="btn small" onClick={() => errAction(e.id, "resolve")} title="Hide this message">
                  ✕
                </button>
              </div>
            </div>
            <details>
              <summary className="small">Advanced</summary>
              <pre className="tech">
                step: {e.step} · code: {e.error.code}
                {e.error.provider ? ` · provider: ${e.error.provider}` : ""}
                {"\n"}
                {e.error.technical}
              </pre>
            </details>
          </div>
        ))}
      </div>

      {h && (
        <>
          <h2 style={{ marginTop: 34 }}>🩺 Health</h2>
          <div className="grid">
            {h.checks.map((c: any) => (
              <div key={c.name} className="card">
                <b>
                  {c.ok ? "✅" : "❌"} {c.name}
                </b>
                <div className="small dim">{c.message}</div>
                {c.fix && <div className="small" style={{ marginTop: 6 }}>Fix: {c.fix}</div>}
              </div>
            ))}
            <div className="card">
              <b>📦 Jobs</b>
              <div className="small dim">
                {h.jobs.running} running · {h.jobs.queued} waiting · {h.jobs.failed} failed
              </div>
            </div>
            <div className="card">
              <b>💸 Spend (estimate)</b>
              <div className="small dim">
                {money(h.cost.last24h)} today · {money(h.cost.total)} total
              </div>
            </div>
          </div>

          <h2 style={{ marginTop: 34 }}>🔌 Connect AI</h2>
          {h.warnings.filter((w: any) => w.level === "warn").map((w: any, i: number) => (
            <div key={i} className="banner warn" style={{ marginBottom: 10 }}>
              <b className="small">{w.message}</b>
            </div>
          ))}
          <Link href="/connect" className="btn primary">
            🔌 Manage AI keys
          </Link>
          {h.warnings.filter((w: any) => w.level === "info").map((w: any, i: number) => (
            <p key={i} className="small dim">
              {w.message} {w.fix}
            </p>
          ))}

          <details style={{ marginTop: 10 }}>
            <summary>Advanced: provider order</summary>
            <p className="small dim">Top = tried first. If it fails, the next one is used automatically. Offline ones are only used when nothing else works.</p>
            <div style={{ display: "grid", gap: 14 }}>
              {h.providers.map((c: any) => {
                const saved: string[] = order[c.capability] || [];
                const list = [...c.providers].sort((a: any, b: any) => {
                  const ia = saved.indexOf(a.id), ib = saved.indexOf(b.id);
                  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
                });
                return (
                  <div key={c.capability} className="card">
                    <b>{CAP[c.capability] || c.capability}</b>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {list.map((p: any, i: number) => (
                        <div key={p.id} className="row" style={{ gap: 8 }}>
                          <span style={{ width: 22 }} className="dim">
                            {i + 1}.
                          </span>
                          <span style={{ flex: 1 }}>
                            {p.available ? "🟢" : "⚪"} {p.label}
                            {p.offline && <span className="badge offline" style={{ marginLeft: 6 }}>offline</span>}
                            {!p.available && <span className="small dim"> (no key)</span>}
                          </span>
                          <button
                            className="btn small"
                            disabled={i === 0}
                            onClick={() => {
                              const ids = list.map((x: any) => x.id);
                              [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                              saveOrder(c.capability, ids);
                            }}
                          >
                            ↑
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          {h.worker && (
            <details>
              <summary>Advanced: worker</summary>
              <pre className="tech">{JSON.stringify(h.worker, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
