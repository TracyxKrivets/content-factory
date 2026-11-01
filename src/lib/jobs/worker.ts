import { db } from "../db";
import { env } from "../env";
import { friendly } from "../errors";
import { runIdeas, runVideo } from "../pipeline/runner";
import { logError } from "../pipeline/tracking";
import type { Job } from "../types";
import { now } from "../util";

/**
 * DB-backed job worker. Runs inside the Next.js server (instrumentation.ts) by default.
 * - claims queued jobs up to WORKER_CONCURRENCY
 * - heartbeats running jobs; jobs whose heartbeat is stale (crash/restart) are re-queued,
 *   and resume from the first unfinished step
 */
const g = globalThis as any;
const STALE_MS = 20_000; // heartbeat runs every tick, so 20s without one = dead worker
const TICK_MS = 1500;

export interface WorkerState {
  startedAt: string;
  lastTick: string | null;
  running: Set<string>;
  processed: number;
  lastError: string | null;
}

export function workerState(): WorkerState | null {
  return g.__cfWorker || null;
}

export function startWorker() {
  if (g.__cfWorker) return;
  const state: WorkerState = { startedAt: now(), lastTick: null, running: new Set(), processed: 0, lastError: null };
  g.__cfWorker = state;
  const concurrency = Math.max(1, Number(env().WORKER_CONCURRENCY || 2));
  console.log(`[worker] started (concurrency ${concurrency}, db ${db().mode})`);

  const tick = async () => {
    try {
      state.lastTick = now();
      await requeueStale(state);
      const free = concurrency - state.running.size;
      if (free > 0) {
        const queued = await db().list("jobs", { where: { status: "queued" }, orderBy: "createdAt", limit: free * 5 });
        const busy = new Set(
          (await db().list("jobs", { where: { status: "running" } })).map((j) => j.videoId || "ideas:" + j.projectId),
        );
        for (const job of queued) {
          if (state.running.size >= concurrency) break;
          const target = job.videoId || "ideas:" + job.projectId;
          if (busy.has(target)) continue; // never run two passes on the same video at once
          if (await claim(job)) {
            busy.add(target);
            void execute(job, state);
          }
        }
      }
      // heartbeat
      for (const id of state.running) await db().update("jobs", id, { lockedAt: now() }).catch(() => {});
    } catch (e: any) {
      state.lastError = e.message;
      console.error("[worker] tick failed:", e.message);
    } finally {
      setTimeout(tick, TICK_MS);
    }
  };
  setTimeout(tick, 500);
}

async function claim(job: Job) {
  const lockedAt = now();
  const repo: any = db();
  if (repo.claimJob) {
    if (!(await repo.claimJob(job.id, lockedAt))) return false;
    await db().update("jobs", job.id, { status: "running", lockedAt, attempts: job.attempts + 1 });
    return true;
  }
  const after = await db().update("jobs", job.id, (j) =>
    j.status === "queued" ? { status: "running" as const, lockedAt, attempts: j.attempts + 1 } : {},
  );
  return after.status === "running" && after.lockedAt === lockedAt;
}

async function requeueStale(state: WorkerState) {
  const running = await db().list("jobs", { where: { status: "running" } });
  for (const j of running) {
    if (state.running.has(j.id)) continue;
    if (!j.lockedAt || Date.now() - Date.parse(j.lockedAt) > STALE_MS) {
      console.log(`[worker] resuming interrupted job ${j.id}`);
      await db().update("jobs", j.id, { status: "queued", lockedAt: null });
      if (j.videoId) {
        // a step left "working" by a crash goes back to waiting
        await db().update("videos", j.videoId, (v) => ({
          status: "queued" as const,
          steps: Object.fromEntries(
            Object.entries(v.steps).map(([k, s]) => [k, s.status === "working" ? { ...s, status: "waiting" } : s]),
          ) as any,
        })).catch(() => {});
      }
    }
  }
}

async function execute(job: Job, state: WorkerState) {
  state.running.add(job.id);
  try {
    if (job.kind === "ideas") await runIdeas(job.projectId);
    else if (job.videoId) await runVideo(job.videoId);
    await db().update("jobs", job.id, { status: "done", lockedAt: null });
  } catch (e: any) {
    // unexpected crash (DB down, bug). Step errors are handled inside runVideo.
    const fe = friendly(e, "system");
    const retry = job.attempts < 3;
    await db()
      .update("jobs", job.id, { status: retry ? "queued" : "error", lastError: e.message, lockedAt: null })
      .catch(() => {});
    await logError(job.userId, job.projectId, job.videoId, "system", fe);
    state.lastError = e.message;
  } finally {
    state.running.delete(job.id);
    state.processed++;
  }
}
