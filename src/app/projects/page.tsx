"use client";
import Link from "next/link";
import { useState } from "react";
import { ago, api, fileUrl, usePoll, useUi } from "@/components/ui";

const STATUS: Record<string, [string, string]> = {
  planning: ["🧠 Planning", "var(--amber)"],
  generating: ["⚙️ Working", "var(--amber)"],
  done: ["✅ Done", "var(--green)"],
  needs_attention: ["⚠️ Needs a hand", "var(--red)"],
};

export default function Projects() {
  const [trash, setTrash] = useState(false);
  const { toast } = useUi();
  const { data, reload } = usePoll<any[]>(`/api/projects${trash ? "?trash=1" : ""}`, 4000);

  return (
    <div>
      <div className="row" style={{ marginTop: 16 }}>
        <h1>{trash ? "🗑 Trash" : "📁 Projects"}</h1>
        <span className="spacer" />
        <button className="btn small" onClick={() => setTrash(!trash)}>
          {trash ? "← Back to projects" : "🗑 Trash"}
        </button>
        {!trash && (
          <Link href="/" className="btn primary small">
            ✚ New
          </Link>
        )}
      </div>
      {!data && <p className="dim">Loading…</p>}
      {data?.length === 0 && (
        <div className="empty">
          <p className="dim">{trash ? "Trash is empty." : "No projects yet."}</p>
          {!trash && (
            <Link href="/" className="btn primary">
              Make your first videos
            </Link>
          )}
        </div>
      )}
      <div className="grid" style={{ marginTop: 10 }}>
        {data?.map((p) => (
          <div key={p.id} className="card" style={{ display: "flex", gap: 14, padding: 14 }}>
            <Link href={`/projects/${p.id}`} style={{ width: 72, flex: "none" }}>
              <div style={{ aspectRatio: "9/16", background: "#05070f", borderRadius: 10, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
                {p.thumb ? <img src={fileUrl(p.thumb)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : p.format.emoji}
              </div>
            </Link>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <Link href={`/projects/${p.id}`} style={{ fontWeight: 700, lineHeight: 1.3 }}>
                {p.title}
              </Link>
              <span className="small" style={{ color: STATUS[p.status]?.[1] }}>
                {STATUS[p.status]?.[0]} · {p.done}/{p.total} videos
              </span>
              <span className="small dim">
                {p.format.emoji} {p.format.name} · {ago(p.createdAt)}
              </span>
              {trash && (
                <button
                  className="btn small primary"
                  onClick={async () => {
                    try {
                      await api(`/api/projects/${p.id}`, { method: "PATCH", body: { action: "restore" } });
                      toast("Restored ✓");
                      reload();
                    } catch (e: any) {
                      toast(e.message, true);
                    }
                  }}
                >
                  ♻️ Restore
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
