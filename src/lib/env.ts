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
  OPENAI_IMAGE_MODEL: opt,
  OPENAI_TTS_MODEL: opt,
  OPENAI_TTS_VOICE: opt,
  ELEVENLABS_MODEL: opt,
  SUPABASE_ANON_KEY: opt,
  APP_SECRET: opt,
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
export const useSupabase = () => !!(env().SUPABASE_URL && env().SUPABASE_SERVICE_ROLE_KEY);

/** Human-readable config problems for the System Health page. */
export function configWarnings(has: (name: string) => boolean): { level: "info" | "warn"; message: string; fix: string }[] {
  const e = env();
  const out: { level: "info" | "warn"; message: string; fix: string }[] = [];
  if (!has("OPENAI_API_KEY") && !has("ANTHROPIC_API_KEY"))
    out.push({
      level: "warn",
      message: "No AI writer connected. Scripts use the simple offline writer.",
      fix: "Paste an Anthropic or OpenAI key below.",
    });
  if (!has("OPENAI_API_KEY") && !has("ELEVENLABS_API_KEY"))
    out.push({
      level: "warn",
      message: "No AI voice connected. Videos use the robot voice.",
      fix: "Paste an ElevenLabs or OpenAI key below.",
    });
  if (!has("OPENAI_API_KEY") && !has("PEXELS_API_KEY"))
    out.push({
      level: "warn",
      message: "No image source connected. Videos use simple title cards.",
      fix: "Paste an OpenAI key (AI images) or a Pexels key (free stock photos) below.",
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
