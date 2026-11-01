import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { dataDir, env } from "./env";
import { now } from "./util";

/**
 * API keys can come from the app (pasted on the System page, stored encrypted per user)
 * or from environment variables. App keys win. Providers call key(NAME), which reads the
 * keys of whichever user the current job / request runs for (AsyncLocalStorage).
 */
export const KEY_DEFS = [
  { name: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", unlocks: "AI scripts", url: "https://console.anthropic.com/settings/keys" },
  { name: "OPENAI_API_KEY", label: "OpenAI", unlocks: "AI scripts, voice, images, exact captions", url: "https://platform.openai.com/api-keys" },
  { name: "ELEVENLABS_API_KEY", label: "ElevenLabs", unlocks: "Best AI voice", url: "https://elevenlabs.io/app/settings/api-keys" },
  { name: "PEXELS_API_KEY", label: "Pexels", unlocks: "Free stock photos", url: "https://www.pexels.com/api/new/" },
] as const;
export type KeyName = (typeof KEY_DEFS)[number]["name"];
const NAMES = KEY_DEFS.map((k) => k.name) as string[];

/** Guess which service a pasted key belongs to. */
export function detectKey(value: string): KeyName | null {
  const v = value.trim();
  if (/^sk-ant-/.test(v)) return "ANTHROPIC_API_KEY";
  if (/^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/.test(v)) return "OPENAI_API_KEY";
  if (/^sk_[a-f0-9]{40,}$/i.test(v) || /^[a-f0-9]{32}$/i.test(v)) return "ELEVENLABS_API_KEY";
  if (/^[A-Za-z0-9]{56}$/.test(v)) return "PEXELS_API_KEY";
  return null;
}

// ---- encryption (AES-256-GCM)
let secret: Buffer | null = null;
function appSecret() {
  if (secret) return secret;
  const e = process.env.APP_SECRET || env().SUPABASE_SERVICE_ROLE_KEY;
  if (e) return (secret = crypto.createHash("sha256").update(e).digest());
  const f = path.join(dataDir(), ".secret");
  try {
    secret = Buffer.from(fs.readFileSync(f, "utf8"), "hex");
  } catch {
    fs.mkdirSync(dataDir(), { recursive: true });
    secret = crypto.randomBytes(32);
    fs.writeFileSync(f, secret.toString("hex"), { mode: 0o600 });
  }
  return secret;
}
function encrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", appSecret(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob: string) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", appSecret(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---- storage (settings table, row "keys-<userId>")
const rowId = (userId: string) => `keys-${userId}`;
const g = globalThis as any;
g.__cfKeyCache ??= new Map<string, { at: number; keys: Record<string, string> }>();

export async function loadKeys(userId: string): Promise<Record<string, string>> {
  const hit = g.__cfKeyCache.get(userId);
  if (hit && Date.now() - hit.at < 10_000) return hit.keys;
  const row: any = await db().get("settings", rowId(userId)).catch(() => null);
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries<string>(row?.keys || {})) {
    try {
      keys[k] = decrypt(v);
    } catch {
      /* secret changed: ignore unreadable key */
    }
  }
  g.__cfKeyCache.set(userId, { at: Date.now(), keys });
  return keys;
}

export async function saveKey(userId: string, name: string, value: string | null) {
  if (!NAMES.includes(name)) throw new Error("Unknown key type");
  const id = rowId(userId);
  const row: any = await db().get("settings", id);
  const keys = { ...(row?.keys || {}) };
  if (value && value.trim()) keys[name] = encrypt(value.trim());
  else delete keys[name];
  if (row) await db().update("settings", id, { keys } as any);
  else {
    const t = now();
    await db().insert("settings", { id, userId, providerOrder: {}, keys, createdAt: t, updatedAt: t } as any);
  }
  g.__cfKeyCache.delete(userId);
}

// ---- request/job scope
const als = new AsyncLocalStorage<{ userId: string; keys: Record<string, string> }>();
export async function withKeys<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ userId, keys: await loadKeys(userId) }, fn);
}
/** Resolve a key: app key for the current user, else environment variable. */
export function key(name: KeyName): string | undefined {
  return als.getStore()?.keys[name] || (env() as any)[name] || undefined;
}
export function keySource(name: KeyName): "app" | "env" | null {
  if (als.getStore()?.keys[name]) return "app";
  return (env() as any)[name] ? "env" : null;
}
export const mask = (v?: string) => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "");

/** Cheap call to check a key works. Returns plain-English result. */
export async function testKey(name: KeyName, value: string): Promise<{ ok: boolean; message: string }> {
  const req: Record<KeyName, () => Promise<Response>> = {
    ANTHROPIC_API_KEY: () =>
      fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": value, "anthropic-version": "2023-06-01" } }),
    OPENAI_API_KEY: () => fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${value}` } }),
    ELEVENLABS_API_KEY: () => fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": value } }),
    PEXELS_API_KEY: () => fetch("https://api.pexels.com/v1/search?query=night&per_page=1", { headers: { Authorization: value } }),
  };
  try {
    const res = await req[name]();
    if (res.ok) return { ok: true, message: "Connected ✓" };
    if (res.status === 401 || res.status === 403) return { ok: false, message: "That key was rejected. Copy it again and paste the whole thing." };
    if (res.status === 429) return { ok: true, message: "Key works (service is busy right now)." };
    return { ok: false, message: `The service answered with an error (${res.status}). Try again in a minute.` };
  } catch {
    return { ok: false, message: "Couldn't reach the service from the server. Check the server's internet." };
  }
}
