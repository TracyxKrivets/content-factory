import { db } from "../db";
import type { Capability, FriendlyError, StepName } from "../types";
import { now, uid } from "../util";

export async function trackUsage(r: {
  userId: string;
  projectId: string | null;
  videoId: string | null;
  capability: Capability | "render";
  provider: string;
  model?: string;
  units: number;
  cost: number;
  cached?: boolean;
}) {
  const t = now();
  await db()
    .insert("usage", { id: uid(), cached: false, ...r, createdAt: t, updatedAt: t })
    .catch((e) => console.error("[usage]", e.message));
}

export async function logHistory(userId: string, projectId: string, videoId: string | null, event: string, detail?: string) {
  const t = now();
  await db()
    .insert("history", { id: uid(), userId, projectId, videoId, event, detail, createdAt: t, updatedAt: t })
    .catch((e) => console.error("[history]", e.message));
}

export async function logError(
  userId: string,
  projectId: string | null,
  videoId: string | null,
  step: StepName | "ideas" | "system",
  error: FriendlyError,
) {
  const t = now();
  console.error(`[error] ${step} ${videoId || projectId || ""}: ${error.technical}`);
  await db()
    .insert("errors", { id: uid(), userId, projectId, videoId, step, error, resolved: false, createdAt: t, updatedAt: t })
    .catch((e) => console.error("[errors]", e.message));
}

/** Mark open errors for a video step resolved once it succeeds. */
export async function resolveErrors(videoId: string | null, step: string, projectId?: string) {
  const open = videoId
    ? await db().list("errors", { where: { videoId } })
    : await db().list("errors", { where: { projectId: projectId! } });
  for (const e of open) if (!e.resolved && e.step === step) await db().update("errors", e.id, { resolved: true });
}

export async function cacheGet<T = any>(key: string): Promise<T | null> {
  const row = await db().get("cache", key).catch(() => null);
  return (row?.value as T) ?? null;
}
export async function cacheSet(key: string, userId: string, value: any) {
  const t = now();
  const existing = await db().get("cache", key).catch(() => null);
  if (existing) await db().update("cache", key, { value });
  else await db().insert("cache", { id: key, userId, value, createdAt: t, updatedAt: t }).catch(() => {});
}
