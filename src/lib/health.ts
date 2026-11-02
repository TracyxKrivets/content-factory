import { db } from "./db";
import { configWarnings, useSupabase } from "./env";
import { ffmpegAvailable } from "./ffmpeg";
import { workerState } from "./jobs/worker";
import { key, type KeyName } from "./keys";
import { providerSummary } from "./providers";
import { LOCAL_USER } from "./util";

export async function health(userId = LOCAL_USER) {
  const checks: { name: string; ok: boolean; message: string; fix?: string }[] = [];

  let dbOk = true;
  try {
    await db().ping();
  } catch (e: any) {
    dbOk = false;
    checks.push({ name: "Database", ok: false, message: "Can't reach the database.", fix: e.message });
  }
  if (dbOk) checks.push({ name: "Database", ok: true, message: useSupabase() ? "Saving to Supabase." : "Saving to this server's disk." });

  const ff = await ffmpegAvailable();
  checks.push(
    !("error" in ff && ff.error)
      ? { name: "Video editor", ok: true, message: (ff as any).source === "bundled" ? "Using the built-in video editor." : "Using this computer's ffmpeg." }
      : { name: "Video editor", ok: false, message: "The video editor is missing.", fix: `Run the start script again (it reinstalls it), or install ffmpeg. (${(ff as any).error})` },
  );

  const w = workerState();
  const tickAge = w?.lastTick ? Date.now() - Date.parse(w.lastTick) : Infinity;
  checks.push(
    w && tickAge < 30_000
      ? { name: "Background worker", ok: true, message: `Running. ${w.running.size} job(s) in progress.` }
      : { name: "Background worker", ok: false, message: "The background worker isn't running.", fix: "Restart the app. If EMBEDDED_WORKER=false, start the worker process." },
  );

  let jobs = { queued: 0, running: 0, failed: 0 };
  let openErrors = 0;
  let cost = { total: 0, last24h: 0 };
  if (dbOk) {
    const [allJobs, errs, usage] = await Promise.all([
      db().list("jobs", { where: { userId }, orderBy: "createdAt", desc: true, limit: 500 }),
      db().list("errors", { where: { userId }, orderBy: "createdAt", desc: true, limit: 300 }),
      db().list("usage", { where: { userId }, orderBy: "createdAt", desc: true, limit: 5000 }),
    ]);
    jobs = {
      queued: allJobs.filter((j) => j.status === "queued").length,
      running: allJobs.filter((j) => j.status === "running").length,
      failed: allJobs.filter((j) => j.status === "error").length,
    };
    openErrors = errs.filter((e) => !e.resolved).length;
    const dayAgo = Date.now() - 86_400_000;
    cost = {
      total: usage.reduce((s, u) => s + u.cost, 0),
      last24h: usage.filter((u) => Date.parse(u.createdAt) > dayAgo).reduce((s, u) => s + u.cost, 0),
    };
  }

  const providers = providerSummary();
  const offlineMode = providers.filter((p) => ["llm", "voice", "image"].includes(p.capability)).some((p) => !p.hasOnline);

  return {
    ok: checks.every((c) => c.ok),
    checks,
    warnings: configWarnings((n) => !!key(n as KeyName)),
    providers,
    offlineMode,
    jobs,
    openErrors,
    cost,
    worker: w ? { startedAt: w.startedAt, lastTick: w.lastTick, running: w.running.size, processed: w.processed, lastError: w.lastError } : null,
  };
}
