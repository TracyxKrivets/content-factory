import { z } from "zod";
import path from "node:path";

const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  OPENAI_API_KEY: opt,
  ANTHROPIC_API_KEY: opt,
  OPENAI_MODEL_CHEAP: opt,
  OPENAI_MODEL_QUALITY: opt,
  ANTHROPIC_MODEL_CHEAP: opt,
  ANTHROPIC_MODEL_QUALITY: opt,
  ELEVENLABS_API_KEY: opt,
  ELEVENLABS_VOICE_ID: opt,
  PEXELS_API_KEY: opt,
  SUPABASE_URL: opt,
  SUPABASE_SERVICE_ROLE_KEY: opt,
  SUPABASE_STORAGE_BUCKET: opt,
  WORKER_CONCURRENCY: opt,
  EMBEDDED_WORKER: opt,
  DATA_DIR: opt,
  FFMPEG_PATH: opt,
  FFPROBE_PATH: opt,
  CAPTION_FONT: opt,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export const dataDir = () => path.resolve(env().DATA_DIR || path.join(process.cwd(), "data"));
export const ffmpegBin = () => env().FFMPEG_PATH || "ffmpeg";
export const ffprobeBin = () => env().FFPROBE_PATH || "ffprobe";
export const useSupabase = () => !!(env().SUPABASE_URL && env().SUPABASE_SERVICE_ROLE_KEY);

/** Human-readable config problems for the System Health page. */
export function configWarnings(): { level: "info" | "warn"; message: string; fix: string }[] {
  const e = env();
  const out: { level: "info" | "warn"; message: string; fix: string }[] = [];
  if (!e.OPENAI_API_KEY && !e.ANTHROPIC_API_KEY)
    out.push({
      level: "warn",
      message: "No AI writer connected. Scripts use the simple offline writer.",
      fix: "Add OPENAI_API_KEY or ANTHROPIC_API_KEY to your environment.",
    });
  if (!e.OPENAI_API_KEY && !e.ELEVENLABS_API_KEY)
    out.push({
      level: "warn",
      message: "No AI voice connected. Videos use the robot voice.",
      fix: "Add ELEVENLABS_API_KEY or OPENAI_API_KEY.",
    });
  if (!e.OPENAI_API_KEY && !e.PEXELS_API_KEY)
    out.push({
      level: "warn",
      message: "No image source connected. Videos use simple title cards.",
      fix: "Add OPENAI_API_KEY (AI images) or PEXELS_API_KEY (free stock photos).",
    });
  if (!!e.SUPABASE_URL !== !!e.SUPABASE_SERVICE_ROLE_KEY)
    out.push({
      level: "warn",
      message: "Database is half set up. Saving to this computer instead.",
      fix: "Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
  if (!useSupabase())
    out.push({
      level: "info",
      message: "Saving projects to this server's disk (./data).",
      fix: "Add Supabase keys to save to the cloud.",
    });
  return out;
}
