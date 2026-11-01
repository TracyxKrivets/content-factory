import crypto from "node:crypto";

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const hash = (...parts: unknown[]) =>
  crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the first JSON object/array out of a model reply. */
export function parseJson<T = any>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[\[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Model did not return JSON: " + cleaned.slice(0, 200));
  }
}

/** Per-key async mutex shared across Next.js bundles via globalThis. */
const g = globalThis as any;
g.__cfLocks ??= new Map<string, Promise<void>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks: Map<string, Promise<void>> = g.__cfLocks;
  const prev = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => next);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

/** Single-user mode until auth is wired: everything belongs to this id. */
export const LOCAL_USER = "local";
