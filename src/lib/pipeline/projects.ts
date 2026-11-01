import { db } from "../db";
import { detectFormat, parseCount } from "../formats/detect";
export { parseCount };
import { listFormats } from "../formats/service";
import { cancelProjectJobs, enqueue } from "../jobs/queue";
import type { Project, Script, StepName, StepState, Video } from "../types";
import { LOCAL_USER, now, uid } from "../util";
import { createVideos, emptySteps, refreshProject } from "./runner";
import { DOWNSTREAM } from "./steps";
import { logHistory } from "./tracking";


export async function createProject(input: {
  request: string;
  formatId?: string | null;
  count?: number | null;
  lengthSec?: number | null;
  language?: string | null;
  userId?: string;
}) {
  const userId = input.userId || LOCAL_USER;
  const request = input.request.trim().slice(0, 2000);
  if (!request) throw new Error("Tell me what to make first.");
  const format =
    (input.formatId && input.formatId !== "auto" && (await db().get("formats", input.formatId))) ||
    detectFormat(request, await listFormats(userId));
  if (!format) throw new Error("No formats found");
  const count = input.count && input.count > 0 ? Math.min(50, input.count) : parseCount(request);
  const t = now();
  const project: Project = {
    id: uid(),
    userId,
    title: request.replace(/^(please\s+)?(make|create|generate)\s+(me\s+)?/i, "").slice(0, 70),
    request,
    formatId: format.id,
    format,
    settings: {
      count,
      lengthSec: input.lengthSec && input.lengthSec > 0 ? input.lengthSec : format.lengthSec,
      language: input.language || "English",
    },
    status: "planning",
    ideas: [],
    deletedAt: null,
    createdAt: t,
    updatedAt: t,
  };
  await db().insert("projects", project);
  await logHistory(userId, project.id, null, "created", request);
  if (count === 1) await createVideos(project, [{ title: project.title, angle: request }]);
  else await enqueue(project, null);
  return project;
}

export async function getProjectFull(id: string) {
  const project = await db().get("projects", id);
  if (!project) return null;
  const [videos, usage] = await Promise.all([
    db().list("videos", { where: { projectId: id } }),
    db().list("usage", { where: { projectId: id } }),
  ]);
  videos.sort((a, b) => a.index - b.index);
  const cost = usage.reduce((s, u) => s + (u.cost || 0), 0);
  return { project, videos, cost };
}

function resetSteps(v: Video, steps: StepName[], bumpSeed: boolean): Record<StepName, StepState> {
  const next = { ...v.steps };
  for (const s of steps) {
    next[s] = {
      status: "waiting",
      attempts: 0,
      seed: bumpSeed ? (v.steps[s].seed || 0) + 1 : v.steps[s].seed,
    };
  }
  return next;
}

export type VideoAction = "retry" | "backup" | "skip" | "regenerate";

export async function videoAction(videoId: string, action: VideoAction, step?: StepName | "all"): Promise<void> {
  const v = await db().get("videos", videoId);
  if (!v) throw new Error("Video not found");
  const project = await db().get("projects", v.projectId);
  if (!project) throw new Error("Project not found");
  if (step && step !== "all" && v.steps[step]?.status === "working") throw new Error("That part is still working.");

  if (action === "regenerate") {
    const s = step || "all";
    const steps: StepName[] = s === "all" ? (Object.keys(v.steps) as StepName[]) : [s, ...DOWNSTREAM[s]];
    await db().update("videos", videoId, (cur) => ({ status: "queued" as const, steps: resetSteps(cur, steps, true) }));
    await logHistory(project.userId, project.id, videoId, "regenerated", s);
  } else {
    const target = step && step !== "all" ? step : (Object.keys(v.steps) as StepName[]).find((k) => v.steps[k].status === "error");
    if (!target) throw new Error("Nothing to fix here.");
    const cur = v.steps[target];
    if (action === "backup") return useBackup(project, v, target);
    if (action === "skip" && !cur.error?.canSkip && cur.status === "error") throw new Error("This part can't be skipped.");
    const patch: Partial<StepState> = action === "skip" ? { status: "skipped", error: undefined } : { status: "waiting", error: undefined };
    await db().update("videos", videoId, (x) => ({
      status: "queued" as const,
      steps: { ...x.steps, [target]: { ...x.steps[target], ...patch } },
    }));
    if (action !== "retry") await logHistory(project.userId, project.id, videoId, action, target);
  }
  await enqueue(project, videoId);
  await db().update("projects", project.id, { status: "generating" });
}

/** Save a hand-edited script. Keeps visuals when the number of lines didn't change. */
export async function editScript(videoId: string, edit: { title?: string; lines: string[]; caption?: string }) {
  const v = await db().get("videos", videoId);
  if (!v) throw new Error("Video not found");
  const project = await db().get("projects", v.projectId);
  if (!project) throw new Error("Project not found");
  const lines = edit.lines.map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("A script needs at least 2 lines.");
  const old: Script | undefined = v.steps.script.output;
  const script: Script = {
    title: edit.title?.trim() || old?.title || lines[0],
    hook: lines[0],
    lines,
    caption: edit.caption ?? old?.caption ?? "",
    hashtags: old?.hashtags || [],
  };
  const sameShape = old && old.lines.length === lines.length && v.steps.scenes.status === "done";
  const redo: StepName[] = sameShape
    ? ["voice", "music", "captions", "assemble", "final_check"]
    : ["scenes", "voice", "visuals", "music", "captions", "assemble", "final_check"];
  await db().update("videos", videoId, (cur) => {
    const steps = resetSteps(cur, redo, false);
    steps.script = { ...cur.steps.script, status: "done", provider: "edited", output: script, error: undefined };
    steps.script_check = { status: "done", attempts: 0, output: { edited: true, issues: [] } };
    if (sameShape)
      steps.scenes = { ...cur.steps.scenes, output: cur.steps.scenes.output.map((s: any, i: number) => ({ ...s, text: lines[i] })) };
    return { title: script.title, status: "queued" as const, steps };
  });
  await logHistory(project.userId, project.id, videoId, "edited");
  await enqueue(project, videoId);
  await db().update("projects", project.id, { status: "generating" });
}

export async function duplicateVideo(videoId: string) {
  const v = await db().get("videos", videoId);
  if (!v) throw new Error("Video not found");
  const project = await db().get("projects", v.projectId);
  if (!project) throw new Error("Project not found");
  const siblings = await db().list("videos", { where: { projectId: v.projectId } });
  const t = now();
  const copy: Video = {
    ...structuredClone(v),
    id: uid(),
    index: Math.max(...siblings.map((s) => s.index)) + 1,
    title: `${v.title} (copy)`,
    createdAt: t,
    updatedAt: t,
  };
  // anything unfinished in the original gets finished in the copy too
  if (copy.status !== "done") {
    copy.status = "queued";
    for (const s of Object.values(copy.steps)) if (s.status === "working") s.status = "waiting";
  }
  await db().insert("videos", copy);
  await logHistory(project.userId, project.id, copy.id, "duplicated", v.id);
  if (copy.status !== "done") await enqueue(project, copy.id);
  return copy;
}

export async function addVideos(projectId: string, count: number) {
  const project = await db().get("projects", projectId);
  if (!project) throw new Error("Project not found");
  const n = Math.min(20, Math.max(1, count));
  const existing = await db().list("videos", { where: { projectId } });
  const base = existing.length;
  await createVideos(
    project,
    Array.from({ length: n }, (_, i) => ({ title: `${project.title} #${base + i + 1}`, angle: `${project.request} (fresh angle #${base + i + 1})` })),
    base,
  );
}

/** Soft delete: hidden from lists, restorable. Never destroys files silently. */
export async function deleteProject(id: string) {
  await cancelProjectJobs(id);
  await db().update("projects", id, { deletedAt: now() });
}
export async function restoreProject(id: string) {
  await db().update("projects", id, { deletedAt: null });
  await refreshProject(id);
}

export async function retryIdeas(projectId: string, backup = false) {
  const p = await db().update("projects", projectId, (cur) => ({
    status: "planning" as const,
    ideaError: undefined,
    settings:
      backup && cur.ideaError?.provider
        ? { ...cur.settings, avoidProviders: [...new Set([...(cur.settings.avoidProviders || []), cur.ideaError.provider])] }
        : cur.settings,
  }));
  await enqueue(p, null);
}

/**
 * "Use backup": stop using the failed provider for the whole project, then
 * re-queue every video in the project that is stuck on that provider.
 */
async function useBackup(project: Project, v: Video, step: StepName): Promise<void> {
  const cur = v.steps[step];
  const bad = cur.error?.provider || cur.provider;
  if (!bad) {
    // unknown provider: avoid nothing, just retry
    return videoAction(v.id, "retry", step);
  }
  const avoid = [...new Set([...(project.settings.avoidProviders || []), bad])];
  await db().update("projects", project.id, (p) => ({ settings: { ...p.settings, avoidProviders: avoid }, status: "generating" as const }));
  const videos = await db().list("videos", { where: { projectId: project.id } });
  for (const x of videos) {
    const stuck = (Object.keys(x.steps) as StepName[]).filter(
      (k) => x.steps[k].status === "error" && (x.steps[k].error?.provider === bad || x.id === v.id && k === step),
    );
    if (!stuck.length) continue;
    await db().update("videos", x.id, (c) => {
      const steps = { ...c.steps };
      for (const k of stuck) steps[k] = { ...steps[k], status: "waiting", error: undefined };
      return { status: "queued" as const, steps };
    });
    await enqueue(project, x.id);
  }
  await logHistory(project.userId, project.id, v.id, "backup", `${step}: stopped using ${bad}`);
}
