import { db } from "../db";
import { friendly, toProviderError } from "../errors";
import { chain, markDown } from "../providers";
import type { LlmProvider } from "../providers/types";
import type { Project, StepName, StepState, Video } from "../types";
import { STEPS } from "../types";
import { now, parseJson, uid } from "../util";
import { ideasPrompt } from "./prompts";
import { STEP_FNS } from "./steps";
import { logError, logHistory, resolveErrors, trackUsage } from "./tracking";

export const emptySteps = (): Record<StepName, StepState> =>
  Object.fromEntries(STEPS.map((s) => [s, { status: "waiting", attempts: 0 }])) as any;

async function setStep(videoId: string, step: StepName, patch: Partial<StepState>) {
  return db().update("videos", videoId, (v) => ({
    steps: { ...v.steps, [step]: { ...v.steps[step], ...patch, updatedAt: now() } },
  }));
}

/** Run every unfinished step of a video in order. Completed steps are never redone. */
export async function runVideo(videoId: string) {
  let video = await db().get("videos", videoId);
  if (!video) return;
  const project = await db().get("projects", video.projectId);
  if (!project || project.deletedAt) return;
  video = await db().update("videos", videoId, { status: "working" });

  for (const step of STEPS) {
    const state = video.steps[step];
    if (state.status === "done" || state.status === "skipped") continue;
    video = await setStep(videoId, step, { status: "working", attempts: state.attempts + 1, error: undefined });
    try {
      const res = await STEP_FNS[step]({
        project,
        video,
        format: project.format,
        state: video.steps[step],
        progress: async (output) => {
          video = await setStep(videoId, step, { output });
        },
        patchStep: async (s, patch) => {
          video = await setStep(videoId, s, patch);
        },
      });
      video = await setStep(videoId, step, {
        status: res.skipped ? "skipped" : "done",
        output: res.output,
        provider: res.provider,
        cost: (state.cost || 0) + (res.cost || 0),
        error: undefined,
      });
      if (step === "script") video = await db().update("videos", videoId, { title: res.output.title });
      await resolveErrors(videoId, step);
    } catch (e) {
      const fe = friendly(e, step);
      video = await setStep(videoId, step, { status: "error", error: fe });
      await db().update("videos", videoId, { status: "needs_attention" });
      await logError(project.userId, project.id, videoId, step, fe);
      await refreshProject(project.id);
      return;
    }
  }
  await db().update("videos", videoId, { status: "done" });
  await logHistory(project.userId, project.id, videoId, "video_done");
  await refreshProject(project.id);
}

/** Plan N distinct ideas with a cheap model, then create the videos. Idempotent. */
export async function runIdeas(projectId: string) {
  const project = await db().get("projects", projectId);
  if (!project || project.deletedAt) return;
  const existing = await db().list("videos", { where: { projectId } });
  if (existing.length) return;

  let ideas = project.ideas;
  if (!ideas.length) {
    try {
      const p = ideasPrompt(project.request, project.format, project.settings.count);
      const providers = await chain("llm", { preferred: project.settings.providers?.llm, avoid: project.settings.avoidProviders, userId: project.userId });
      let lastErr: unknown;
      for (const prov of providers as LlmProvider[]) {
        try {
          const r = await prov.complete({ task: "ideas", tier: "cheap", ...p, input: { request: project.request, count: project.settings.count, format: project.format } });
          const j = parseJson(r.text);
          ideas = (Array.isArray(j.ideas) ? j.ideas : [])
            .map((x: any) => ({ title: String(x.title || "").slice(0, 80), angle: String(x.angle || x.title || "") }))
            .filter((x: any) => x.angle);
          await trackUsage({ userId: project.userId, projectId, videoId: null, capability: "llm", provider: prov.id, model: r.model, units: r.inputTokens + r.outputTokens, cost: r.cost });
          if (ideas.length) break;
        } catch (e) {
          const pe = toProviderError(e, prov.id);
          pe.provider ??= prov.id;
          if (["auth", "quota", "missing_key", "network"].includes(pe.code)) markDown(prov.id);
          lastErr = pe;
        }
      }
      if (!ideas.length) throw lastErr || new Error("No ideas returned");
    } catch (e) {
      const fe = friendly(e, "ideas");
      await db().update("projects", projectId, { status: "needs_attention", ideaError: fe });
      await logError(project.userId, projectId, null, "ideas", fe);
      return;
    }
    // pad if the model returned fewer than asked
    while (ideas.length < project.settings.count)
      ideas.push({ ...ideas[ideas.length % Math.max(1, ideas.length)], title: `${ideas[0].title} #${ideas.length + 1}` });
    ideas = ideas.slice(0, project.settings.count);
    await db().update("projects", projectId, { ideas, ideaError: undefined });
    await resolveErrors(null, "ideas", projectId);
  }
  await createVideos(project, ideas);
}

export async function createVideos(project: Project, ideas: { title: string; angle: string }[], startIndex = 0) {
  const { enqueue } = await import("../jobs/queue");
  const t = Date.now();
  for (const [i, idea] of ideas.entries()) {
    const v: Video = {
      id: uid(),
      projectId: project.id,
      userId: project.userId,
      index: startIndex + i,
      title: idea.title || `Video ${startIndex + i + 1}`,
      idea: `${idea.title}. ${idea.angle}`.trim(),
      angle: idea.angle,
      status: "queued",
      steps: emptySteps(),
      createdAt: new Date(t + i).toISOString(),
      updatedAt: new Date(t + i).toISOString(),
    };
    await db().insert("videos", v);
    await enqueue(project, v.id);
  }
  await db().update("projects", project.id, { status: "generating" });
}

export async function refreshProject(projectId: string) {
  const videos = await db().list("videos", { where: { projectId } });
  if (!videos.length) return;
  const status = videos.some((v) => v.status === "queued" || v.status === "working")
    ? "generating"
    : videos.some((v) => v.status === "needs_attention")
      ? "needs_attention"
      : "done";
  await db().update("projects", projectId, { status });
}
