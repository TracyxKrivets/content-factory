import fs from "node:fs/promises";
import path from "node:path";
import { ProviderError, toProviderError } from "../errors";
import { probe } from "../ffmpeg";
import { chain, markDown, markUp } from "../providers";
import type { AnyProvider, LlmProvider, LlmRequest, LlmTask, Tier } from "../providers/types";
import * as store from "../storage";
import type { Capability, Format, Project, Scene, Script, StepName, StepState, Video } from "../types";
import { hash, parseJson, sleep } from "../util";
import { buildAss } from "./captions";
import { checkPrompt, rewritePrompt, scenesPrompt, scriptPrompt, targetWords } from "./prompts";
import { renderer } from "./render";
import { cacheGet, cacheSet, logHistory, trackUsage } from "./tracking";

export interface StepCtx {
  project: Project;
  video: Video;
  format: Format;
  state: StepState;
  /** persist partial progress without finishing the step */
  progress(output: any): Promise<void>;
  /** patch another step's output (used by quality check rewrite) */
  patchStep(step: StepName, patch: Partial<StepState>): Promise<void>;
}
export interface StepResult {
  output: any;
  provider?: string;
  cost?: number;
  skipped?: boolean;
}

const assetKey = (v: Video, name: string) => `p/${v.projectId}/${v.id}/${name}`;
const stamp = () => Date.now().toString(36);

/** Try each provider in the chain; retry temporary failures with backoff. */
async function withProviders<C extends Capability, R>(
  cap: C,
  ctx: StepCtx,
  fn: (p: AnyProvider) => Promise<R>,
): Promise<{ result: R; provider: AnyProvider }> {
  const providers = await chain(cap, {
    preferred: ctx.project.settings.providers?.[cap],
    avoid: [...(ctx.project.settings.avoidProviders || []), ...(ctx.state.avoidProviders || [])],
    userId: ctx.project.userId,
  });
  if (!providers.length) throw new ProviderError("missing_key", `No ${cap} provider available`);
  let last: ProviderError | null = null;
  for (const p of providers) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await fn(p as AnyProvider);
        markUp(p.id);
        return { result, provider: p as AnyProvider };
      } catch (e) {
        last = toProviderError(e, p.id);
        last.provider ??= p.id;
        if (["auth", "quota", "missing_key", "network"].includes(last.code) && !(last.retryable && attempt < 2)) markDown(p.id);
        if (last.retryable && attempt < 2) {
          await sleep(1500 * 2 ** attempt);
          continue;
        }
        break; // move on to next provider
      }
    }
  }
  throw last!;
}

async function llm(ctx: StepCtx, task: LlmTask, tier: Tier, p: { system: string; prompt: string; maxTokens: number }, input: any) {
  const key = hash("llm", task, tier, p.system, p.prompt, ctx.state.seed || 0);
  const hit = await cacheGet<{ json: any; provider: string }>(key);
  if (hit) {
    // cached results are only reused if that provider is still allowed
    const avoid = [...(ctx.project.settings.avoidProviders || []), ...(ctx.state.avoidProviders || [])];
    if (!avoid.includes(hit.provider)) return { json: hit.json, provider: hit.provider, cost: 0 };
  }
  const { result, provider } = await withProviders("llm", ctx, async (prov) => {
    const req: LlmRequest = { task, tier, ...p, input };
    const r = await (prov as LlmProvider).complete(req);
    return { r, json: parseJson(r.text) };
  });
  await trackUsage({
    userId: ctx.project.userId, projectId: ctx.project.id, videoId: ctx.video.id, capability: "llm",
    provider: provider.id, model: result.r.model, units: result.r.inputTokens + result.r.outputTokens, cost: result.r.cost,
  });
  await cacheSet(key, ctx.project.userId, { json: result.json, provider: provider.id });
  return { json: result.json, provider: provider.id, cost: result.r.cost };
}

function normalizeScript(j: any): Script {
  const lines: string[] = (Array.isArray(j?.lines) ? j.lines : [])
    .map((l: any) => String(l).trim())
    .filter(Boolean);
  if (lines.length < 3) throw new ProviderError("bad_output", "Script came back too short: " + JSON.stringify(j).slice(0, 300), { retryable: true });
  return {
    title: String(j.title || lines[0]).slice(0, 80),
    hook: lines[0],
    lines,
    caption: String(j.caption || ""),
    hashtags: (Array.isArray(j.hashtags) ? j.hashtags : []).map(String).slice(0, 8),
  };
}

const scriptOf = (v: Video): Script => v.steps.script.output;
const lengthOf = (ctx: StepCtx) => ctx.project.settings.lengthSec || ctx.format.lengthSec;

// ---------------------------------------------------------------- steps

async function script(ctx: StepCtx): Promise<StepResult> {
  const p = scriptPrompt({
    idea: ctx.video.idea, request: ctx.project.request, format: ctx.format,
    lengthSec: lengthOf(ctx), language: ctx.project.settings.language,
  });
  const r = await llm(ctx, "script", "quality", p, {
    idea: ctx.video.idea, angle: ctx.video.angle, request: ctx.project.request, format: ctx.format, lengthSec: lengthOf(ctx),
  });
  return { output: normalizeScript(r.json), provider: r.provider, cost: r.cost };
}

/** Local rule checks: free, run before spending tokens. */
export function localScriptIssues(s: Script, lengthSec: number) {
  const issues: string[] = [];
  const words = s.lines.join(" ").split(/\s+/).length;
  const target = targetWords(lengthSec);
  if (words < target * 0.7) issues.push(`Too short: ${words} words, need about ${target}.`);
  if (words > target * 1.35) issues.push(`Too long: ${words} words, need about ${target}.`);
  if (/^(hi|hello|hey|welcome to my|today|in this video|so,)/i.test(s.lines[0])) issues.push("Boring intro: start with the hook.");
  if (s.lines[0].split(/\s+/).length > 24) issues.push("Hook is too long. Make line 1 punchier.");
  return issues;
}

async function scriptCheck(ctx: StepCtx): Promise<StepResult> {
  const s = scriptOf(ctx.video);
  if (ctx.video.steps.script.provider === "edited") return { output: { edited: true, issues: [] } };
  const local = localScriptIssues(s, lengthOf(ctx));
  const chk = await llm(ctx, "check", "cheap", checkPrompt(s, lengthOf(ctx)), { script: s });
  const scores = chk.json || {};
  const aiIssues: string[] = Array.isArray(scores.issues) ? scores.issues.map(String) : [];
  const weak = ["hook", "pacing", "escalation", "ending"].filter((k) => Number(scores[k]) > 0 && Number(scores[k]) < 7);
  const pass = local.length === 0 && (scores.pass !== false) && weak.length === 0;
  let cost = chk.cost;
  if (pass) return { output: { scores, issues: [], rewrote: false }, provider: chk.provider, cost };

  // Regenerate only the script, once, with targeted feedback.
  const issues = [...local, ...aiIssues].slice(0, 6);
  const rw = await llm(
    ctx, "rewrite", "quality",
    rewritePrompt({ script: s, issues, format: ctx.format, lengthSec: lengthOf(ctx), language: ctx.project.settings.language }),
    { idea: ctx.video.idea + " (v2)", request: ctx.project.request, format: ctx.format, lengthSec: lengthOf(ctx) },
  );
  cost += rw.cost;
  const fixed = normalizeScript(rw.json);
  await ctx.patchStep("script", { output: fixed });
  await logHistory(ctx.project.userId, ctx.project.id, ctx.video.id, "script_rewritten", issues.join("; "));
  return {
    output: { scores, issues, rewrote: true, remaining: localScriptIssues(fixed, lengthOf(ctx)) },
    provider: chk.provider,
    cost,
  };
}

async function scenes(ctx: StepCtx): Promise<StepResult> {
  const s = scriptOf(ctx.video);
  const r = await llm(ctx, "scenes", "cheap", scenesPrompt(s.lines, ctx.format), { lines: s.lines, format: ctx.format });
  const raw: any[] = Array.isArray(r.json?.scenes) ? r.json.scenes : [];
  if (!raw.length) throw new ProviderError("bad_output", "No scenes returned", { retryable: true });
  const seen = new Set<string>();
  const out: Scene[] = s.lines.map((line, i) => {
    const sc = raw[i] || raw[raw.length - 1];
    let visual = String(sc?.visual || line).trim();
    if (seen.has(visual.toLowerCase())) visual += ", different angle and composition";
    seen.add(visual.toLowerCase());
    return { text: line, visual, search: String(sc?.search || line.split(" ").slice(0, 3).join(" ")) };
  });
  return { output: out, provider: r.provider, cost: r.cost };
}

async function voice(ctx: StepCtx): Promise<StepResult> {
  const text = scriptOf(ctx.video).lines.join(" ");
  const key = assetKey(ctx.video, `voice-${stamp()}.mp3`);
  const out = await store.prepare(key);
  const { result, provider } = await withProviders("voice", ctx, async (p) => {
    const cacheKey = hash("voice", p.id, text, ctx.format.voiceStyle, ctx.state.seed || 0);
    const hit = await cacheGet<{ key: string; duration: number }>(cacheKey);
    if (hit && (await store.exists(hit.key))) return { ...hit, cost: 0, cached: true };
    const r = await (p as any).speak({ text, style: ctx.format.voiceStyle, language: ctx.project.settings.language, outPath: out });
    const duration = (await probe(out)).duration;
    if (!duration || duration < 1) throw new ProviderError("bad_output", "Voice audio is empty", { provider: p.id });
    await store.commit(key);
    await cacheSet(cacheKey, ctx.project.userId, { key, duration });
    await trackUsage({
      userId: ctx.project.userId, projectId: ctx.project.id, videoId: ctx.video.id, capability: "voice",
      provider: p.id, units: r.units, cost: r.cost,
    });
    return { key, duration, cost: r.cost, cached: false };
  });
  return { output: { key: result.key, duration: result.duration }, provider: provider.id, cost: result.cost };
}

async function visuals(ctx: StepCtx): Promise<StepResult> {
  const sc: Scene[] = ctx.video.steps.scenes.output;
  const prev = (ctx.state.output?.partial as { key: string; provider: string; sourceId?: string }[]) || [];
  const done = [...prev];
  let cost = 0;
  for (let i = done.length; i < sc.length; i++) {
    const s = sc[i];
    const { result, provider } = await withProviders("image", ctx, async (p) => {
      const cacheKey = hash("img", p.id, s.visual, s.search, ctx.state.seed || 0);
      const hit = await cacheGet<{ key: string; sourceId?: string }>(cacheKey);
      if (hit && (await store.exists(hit.key)) && !done.some((d) => d.key === hit.key)) return { ...hit, cost: 0 };
      const base = assetKey(ctx.video, `scene-${i}-${stamp()}.img`);
      const outPath = await store.prepare(base);
      const r = await (p as any).generate({
        prompt: s.visual, search: s.search, text: s.text, format: ctx.format, outPath,
        avoid: done.map((d) => d.sourceId).filter(Boolean),
      });
      const key = path.posix.join(path.posix.dirname(base), path.basename(r.path));
      await store.commit(key);
      await cacheSet(cacheKey, ctx.project.userId, { key, sourceId: r.sourceId });
      await trackUsage({
        userId: ctx.project.userId, projectId: ctx.project.id, videoId: ctx.video.id, capability: "image",
        provider: p.id, units: 1, cost: r.cost,
      });
      return { key, sourceId: r.sourceId as string | undefined, cost: r.cost as number };
    });
    cost += result.cost;
    done.push({ key: result.key, provider: provider.id, sourceId: result.sourceId });
    await ctx.progress({ partial: done }); // keep finished images if a later one fails
  }
  const providers = [...new Set(done.map((d) => d.provider))];
  return { output: { images: done.map((d) => d.key), partial: done }, provider: providers.join(", "), cost };
}

async function music(ctx: StepCtx): Promise<StepResult> {
  if (ctx.format.musicStyle === "none") return { output: { none: true }, skipped: true };
  const dur = ctx.video.steps.voice.output.duration;
  const key = assetKey(ctx.video, `music-${stamp()}.mp3`);
  const out = await store.prepare(key);
  const { result, provider } = await withProviders("music", ctx, async (p) => {
    const r = await (p as any).make({ style: ctx.format.musicStyle, duration: dur, outPath: out });
    await store.commit(key);
    return r;
  });
  return { output: { key }, provider: provider.id, cost: result.cost };
}

async function captions(ctx: StepCtx): Promise<StepResult> {
  const v = ctx.video.steps.voice.output;
  const text = scriptOf(ctx.video).lines.join(" ");
  const audioPath = await store.ensureLocal(v.key);
  const { result, provider } = await withProviders("captions", ctx, (p) =>
    (p as any).timings({ audioPath, text, duration: v.duration }),
  );
  const r = result as { words: any[]; cost: number };
  const key = assetKey(ctx.video, `captions-${stamp()}.ass`);
  await fs.writeFile(await store.prepare(key), buildAss(r.words, ctx.format.captionStyle));
  await store.commit(key);
  if (r.cost)
    await trackUsage({
      userId: ctx.project.userId, projectId: ctx.project.id, videoId: ctx.video.id, capability: "captions",
      provider: provider.id, units: r.words.length, cost: r.cost,
    });
  return { output: { key, words: r.words.length }, provider: provider.id, cost: r.cost };
}

async function assemble(ctx: StepCtx): Promise<StepResult> {
  const st = ctx.video.steps;
  const sc: Scene[] = st.scenes.output;
  const images = await Promise.all((st.visuals.output.images as string[]).map((k) => store.ensureLocal(k)));
  const voicePath = await store.ensureLocal(st.voice.output.key);
  const musicPath = st.music.status === "done" && st.music.output?.key ? await store.ensureLocal(st.music.output.key) : undefined;
  const captionsPath = st.captions.status === "done" ? await store.ensureLocal(st.captions.output.key) : undefined;
  const key = assetKey(ctx.video, `final-${stamp()}.mp4`);
  const outPath = await store.prepare(key);
  const r = renderer();
  try {
    const { duration } = await r.render({
      images, sceneWeights: sc.map((s) => s.text.length + 10), voicePath, voiceDuration: st.voice.output.duration,
      musicPath, captionsPath, outPath,
    });
    await store.commit(key);
    return { output: { key, duration }, provider: r.id, cost: 0 };
  } catch (e: any) {
    throw new ProviderError("render_failed", e.message, { provider: r.id, retryable: false });
  }
}

async function finalCheck(ctx: StepCtx): Promise<StepResult> {
  const st = ctx.video.steps;
  const file = await store.ensureLocal(st.assemble.output.key);
  const p = await probe(file);
  const checks = [
    { name: "Vertical 9:16 (1080×1920)", ok: p.width === 1080 && p.height === 1920 },
    { name: "Has sound", ok: p.hasAudio },
    { name: "Audio and video line up", ok: Math.abs(p.duration - (st.voice.output.duration + 0.8)) < 1.5 },
    { name: "Captions included", ok: st.captions.status === "done" || st.captions.status === "skipped" },
    { name: "All scenes have visuals", ok: (st.visuals.output.images || []).length === (st.scenes.output || []).length },
    { name: "Under 3 minutes (Shorts limit)", ok: p.duration > 3 && p.duration <= 180 },
  ];
  const failed = checks.filter((c) => !c.ok);
  if (failed.length)
    throw new ProviderError("quality_failed", "Final check failed: " + failed.map((f) => f.name).join(", "), { retryable: false });
  return { output: { checks, duration: p.duration } };
}

export const STEP_FNS: Record<StepName, (ctx: StepCtx) => Promise<StepResult>> = {
  script,
  script_check: scriptCheck,
  scenes,
  voice,
  visuals,
  music,
  captions,
  assemble,
  final_check: finalCheck,
};

/** Which steps must be redone when a step changes. */
export const DOWNSTREAM: Record<StepName, StepName[]> = {
  script: ["script_check", "scenes", "voice", "visuals", "music", "captions", "assemble", "final_check"],
  script_check: [],
  scenes: ["visuals", "assemble", "final_check"],
  voice: ["music", "captions", "assemble", "final_check"],
  visuals: ["assemble", "final_check"],
  music: ["assemble", "final_check"],
  captions: ["assemble", "final_check"],
  assemble: ["final_check"],
  final_check: [],
};
