import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { dataDir, env, useSupabase } from "./env";

/**
 * Assets are addressed by key, e.g. "p/<projectId>/<videoId>/voice.mp3".
 * Work always happens on local disk (ffmpeg needs files). With Supabase configured,
 * every finished asset is also uploaded, and missing local files are re-downloaded,
 * so a job can resume on a different machine.
 */
export const localPath = (key: string) => path.join(dataDir(), "files", key);

function bucket() {
  const sb = createClient(env().SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  return sb.storage.from(env().SUPABASE_STORAGE_BUCKET || "content-factory");
}

export async function prepare(key: string) {
  const p = localPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  return p;
}

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ass": "text/plain",
};
export const contentType = (key: string) => TYPES[path.extname(key)] || "application/octet-stream";

/** Call after writing localPath(key). */
export async function commit(key: string) {
  const st = await fs.stat(localPath(key)).catch(() => null);
  if (!st || st.size === 0) throw new Error(`Asset missing or empty: ${key}`);
  if (useSupabase()) {
    const body = await fs.readFile(localPath(key));
    const { error } = await bucket().upload(key, body, { upsert: true, contentType: contentType(key) });
    if (error) throw new Error(`Upload failed for ${key}: ${error.message}`);
  }
}

export async function exists(key: string) {
  if (await fs.stat(localPath(key)).then((s) => s.size > 0).catch(() => false)) return true;
  if (!useSupabase()) return false;
  const { data } = await bucket().download(key).catch(() => ({ data: null }) as any);
  return !!data;
}

/** Make sure the asset is on local disk; returns its path. */
export async function ensureLocal(key: string) {
  const p = localPath(key);
  if (await fs.stat(p).then((s) => s.size > 0).catch(() => false)) return p;
  if (useSupabase()) {
    const { data, error } = await bucket().download(key);
    if (data && !error) {
      await prepare(key);
      await fs.writeFile(p, Buffer.from(await data.arrayBuffer()));
      return p;
    }
  }
  throw Object.assign(new Error(`Missing file: ${key}`), { code: "missing_asset" });
}

export async function removePrefix(prefix: string) {
  await fs.rm(localPath(prefix), { recursive: true, force: true });
}
