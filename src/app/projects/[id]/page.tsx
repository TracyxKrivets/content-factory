"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ErrorBox, VideoCard, WorkerStrip } from "@/components/project";
import { api, money, usePoll, useUi } from "@/components/ui";
import type { Project, Video } from "@/lib/types";
import { STEPS } from "@/lib/types";

type Full = { project: Project; videos: Video[]; cost: number; labels: Record<string, { label: string; offline: boolean }> };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, confirm } = useUi();
  const { data, error, reload } = usePoll<Full>(`/api/projects/${id}`, 2000);

  if (error && !data)
    return (
      <div className="empty">
        <h2>Couldn't open this project</h2>
        <p className="dim">{error}</p>
        <Link href="/projects" className="btn">
          ← All projects
        </Link>
      </div>
    );
  if (!data) return <div className="empty dim">Loading…</div>;

  const { project: p, videos } = data;
  const total = videos.length * STEPS.length || 1;
  const finished = videos.reduce((n, v) => n + STEPS.filter((s) => ["done", "skipped"].includes(v.steps[s].status)).length, 0);
  const pct = Math.round((finished / total) * 100);
  const doneCount = videos.filter((v) => v.status === "done").length;
  const problems = videos.filter((v) => v.status === "needs_attention").length;

  async function projectAction(action: string, extra: any = {}) {
    try {
      await api(`/api/projects/${id}`, { method: "PATCH", body: { action, ...extra } });
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginTop: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="badge">
              {p.format.emoji} {p.format.name}
            </span>
            <span className="saved">✓ Saved automatically</span>
            {data.cost > 0 && <span className="badge">Cost so far {money(data.cost)}</span>}
            {p.deletedAt && <span className="badge" style={{ color: "var(--red)" }}>In trash</span>}
          </div>
          <h1 style={{ fontSize: 26 }}>{p.title}</h1>
          <p className="dim small" style={{ margin: 0 }}>“{p.request}”</p>
        </div>
      </div>

      {p.deletedAt && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          This project is in the trash.
          <button className="btn small primary" onClick={() => projectAction("restore")}>
            Restore it
          </button>
        </div>
      )}

      {/* planning state */}
      {videos.length === 0 && !p.ideaError && (
        <div className="card" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48 }} className="spin">
            🧠
          </div>
          <h2 style={{ marginTop: 12 }}>Coming up with {p.settings.count} video ideas…</h2>
          <p className="dim">This takes a few seconds. You can leave this page; it keeps going.</p>
        </div>
      )}
      {p.ideaError && (
        <div style={{ marginTop: 20 }}>
          <ErrorBox err={p.ideaError} onAction={(a) => projectAction("retry_ideas", { backup: a === "backup" })} />
        </div>
      )}

      {videos.length > 0 && (
        <>
          <div className="card" style={{ marginTop: 20 }}>
            <WorkerStrip videos={videos} />
            <div className="row" style={{ marginTop: 14 }}>
              <div className="bar" style={{ flex: 1 }}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <b className="small">
                {doneCount}/{videos.length} ready
              </b>
            </div>
            {p.status === "generating" && (
              <p className="small dim" style={{ margin: "10px 0 0" }}>
                Working on it. You can close this page; it keeps going and saves everything.
              </p>
            )}
            {problems > 0 && p.status !== "generating" && (
              <p className="small" style={{ margin: "10px 0 0", color: "#ffc9cb" }}>
                {problems} video{problems > 1 ? "s need" : " needs"} a hand. Look for the red cards below.
              </p>
            )}
            {p.status === "done" && (
              <p className="small" style={{ margin: "10px 0 0", color: "var(--green)" }}>
                🎉 All done! Download below.
              </p>
            )}
          </div>

          <div className="grid" style={{ marginTop: 20, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {videos.map((v) => (
              <VideoCard key={v.id} v={v} labels={data.labels} onChange={reload} />
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 30 }}>
        {videos.length > 0 && !p.deletedAt && (
          <>
            <button className="btn" onClick={() => projectAction("add_videos", { count: 1 })}>
              ✚ 1 more video
            </button>
            <button className="btn" onClick={() => projectAction("add_videos", { count: 5 })}>
              ✚ 5 more
            </button>
          </>
        )}
        <span className="spacer" />
        {!p.deletedAt && (
          <button
            className="btn danger small"
            onClick={async () => {
              if (!(await confirm({ title: "Move this project to the trash?", body: "You can restore it from Projects → Trash.", yes: "Move to trash", danger: true })))
                return;
              await projectAction("delete");
              router.push("/projects");
            }}
          >
            🗑 Trash project
          </button>
        )}
      </div>
    </div>
  );
}
