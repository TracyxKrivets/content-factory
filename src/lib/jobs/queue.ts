import { db } from "../db";
import type { Job, Project } from "../types";
import { now, uid } from "../util";

/** Queue a video (or the idea planner when videoId is null). Never double-queues. */
export async function enqueue(project: Pick<Project, "id" | "userId">, videoId: string | null) {
  const kind = videoId ? "video" : "ideas";
  const open = await db().list("jobs", { where: { projectId: project.id } });
  const dup = open.find((j) => j.videoId === videoId && j.kind === kind && (j.status === "queued" || j.status === "running"));
  if (dup) {
    // A running job will finish its current pass; queue one more so new changes get picked up.
    if (dup.status === "queued") return dup;
  }
  const t = now();
  const job: Job = {
    id: uid(), userId: project.userId, projectId: project.id, videoId, kind,
    status: "queued", attempts: 0, lockedAt: null, createdAt: t, updatedAt: t,
  };
  return db().insert("jobs", job);
}

export async function cancelProjectJobs(projectId: string) {
  for (const j of await db().list("jobs", { where: { projectId, status: "queued" } }))
    await db().update("jobs", j.id, { status: "done", lastError: "cancelled" });
}
