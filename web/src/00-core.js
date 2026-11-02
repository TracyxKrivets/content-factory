// ============================================================================
// Content Factory — single-file browser edition
// Everything runs in this page: AI calls (with your keys), storage (IndexedDB),
// and video rendering (WebCodecs → MP4). No server, no install.
// ============================================================================
const { html, render, useState, useEffect, useRef, useMemo, useCallback } = window.htmPreact;

// ---------------------------------------------------------------- utilities
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
async function hash(...parts) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function parseJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.search(/[\[{]/);
    const e = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new ProviderError("bad_output", "Model did not return JSON: " + cleaned.slice(0, 200), { retryable: true });
  }
}
const money = (n) => (n > 0 && n < 0.01 ? "<$0.01" : `$${(n || 0).toFixed(2)}`);
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
const safeName = (s) => String(s).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "video";

// change bus: UI re-reads after any write
const bus = new EventTarget();
let changeTimer = null;
function changed() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => bus.dispatchEvent(new Event("change")), 60);
}

// ---------------------------------------------------------------- storage (IndexedDB)
const DB_NAME = "content-factory-web";
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("projects", { keyPath: "id" });
      d.createObjectStore("videos", { keyPath: "id" }).createIndex("projectId", "projectId");
      d.createObjectStore("formats", { keyPath: "id" });
      d.createObjectStore("blobs");
      d.createObjectStore("kv");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
async function tx(store, mode, fn) {
  const d = await idb();
  const t = d.transaction(store, mode);
  const out = await fn(t.objectStore(store));
  await new Promise((res, rej) => ((t.oncomplete = res), (t.onerror = () => rej(t.error)), (t.onabort = () => rej(t.error))));
  return out;
}
const db = {
  get: (s, k) => tx(s, "readonly", (o) => req(o.get(k))),
  all: (s) => tx(s, "readonly", (o) => req(o.getAll())),
  byIndex: (s, i, v) => tx(s, "readonly", (o) => req(o.index(i).getAll(v))),
  put: async (s, v, k) => {
    await tx(s, "readwrite", (o) => req(k === undefined ? o.put(v) : o.put(v, k)));
    changed();
    return v;
  },
  del: async (s, k) => {
    await tx(s, "readwrite", (o) => req(o.delete(k)));
    changed();
  },
};
// serialize read-modify-write per row (several videos render at once)
const locks = new Map();
async function update(store, id, fn) {
  const prev = locks.get(store + id) || Promise.resolve();
  let release;
  const p = new Promise((r) => (release = r));
  locks.set(store + id, prev.then(() => p));
  await prev;
  try {
    const cur = await db.get(store, id);
    if (!cur) throw new Error(`${store} ${id} not found`);
    const patch = typeof fn === "function" ? fn(cur) : fn;
    const next = { ...cur, ...patch, updatedAt: now() };
    await db.put(store, next);
    return next;
  } finally {
    release();
  }
}
const kv = {
  get: (k, d = null) => db.get("kv", k).then((v) => (v === undefined ? d : v)),
  set: (k, v) => db.put("kv", v, k),
};
const blobs = {
  get: (k) => db.get("blobs", k),
  put: (k, b) => db.put("blobs", b, k),
  del: (k) => db.del("blobs", k),
};

// ---------------------------------------------------------------- API keys (this browser only)
const KEY_DEFS = [
  { name: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", unlocks: "AI scripts", url: "https://console.anthropic.com/settings/keys" },
  { name: "OPENAI_API_KEY", label: "OpenAI", unlocks: "AI scripts, voice, images, exact captions", url: "https://platform.openai.com/api-keys" },
  { name: "ELEVENLABS_API_KEY", label: "ElevenLabs", unlocks: "Best AI voice", url: "https://elevenlabs.io/app/settings/api-keys" },
  { name: "PEXELS_API_KEY", label: "Pexels", unlocks: "Free stock photos", url: "https://www.pexels.com/api/new/" },
];
const keys = {
  all() {
    try {
      return JSON.parse(localStorage.getItem("cf-keys") || "{}");
    } catch {
      return {};
    }
  },
  get: (n) => keys.all()[n] || "",
  set(n, v) {
    const k = keys.all();
    if (v) k[n] = v.trim();
    else delete k[n];
    localStorage.setItem("cf-keys", JSON.stringify(k));
    changed();
  },
};
function detectKey(value) {
  const v = value.trim();
  if (/^sk-ant-/.test(v)) return "ANTHROPIC_API_KEY";
  if (/^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/.test(v)) return "OPENAI_API_KEY";
  if (/^sk_[a-f0-9]{40,}$/i.test(v) || /^[a-f0-9]{32}$/i.test(v)) return "ELEVENLABS_API_KEY";
  if (/^[A-Za-z0-9]{56}$/.test(v)) return "PEXELS_API_KEY";
  return null;
}
const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "");

// ---------------------------------------------------------------- errors
class ProviderError extends Error {
  constructor(code, message, opts = {}) {
    super(message);
    this.code = code;
    this.retryable = opts.retryable ?? ["rate_limit", "timeout", "network"].includes(code);
    this.provider = opts.provider;
  }
}
async function httpError(res, provider) {
  const body = (await res.text().catch(() => "")).slice(0, 600);
  const b = body.toLowerCase();
  const msg = `${provider} HTTP ${res.status}: ${body}`;
  if (res.status === 401 || res.status === 403) return new ProviderError("auth", msg, { provider });
  if (res.status === 402 || /quota|insufficient|credit|billing|exceeded your/.test(b)) return new ProviderError("quota", msg, { provider });
  if (res.status === 429) return new ProviderError("rate_limit", msg, { provider });
  if (/safety|content_policy|moderation|policy_violation|not allowed|blocked/.test(b)) return new ProviderError("content_blocked", msg, { provider });
  if (res.status === 408 || res.status === 504) return new ProviderError("timeout", msg, { provider });
  if (res.status >= 500) return new ProviderError("network", msg, { provider, retryable: true });
  return new ProviderError("unknown", msg, { provider });
}
function toProviderError(e, provider) {
  if (e instanceof ProviderError) return e;
  const m = String(e?.message || e);
  if (e?.name === "AbortError" || e?.name === "TimeoutError" || /timed? ?out/i.test(m)) return new ProviderError("timeout", m, { provider });
  if (/failed to fetch|networkerror|load failed|network/i.test(m)) return new ProviderError("network", m, { provider });
  if (/JSON/i.test(m)) return new ProviderError("bad_output", m, { provider, retryable: true });
  return new ProviderError("unknown", m, { provider });
}
const WHO = {
  script: "The writer", script_check: "The script checker", scenes: "The scene planner", ideas: "The idea maker",
  voice: "The voice generator", visuals: "The image generator", music: "The music maker", captions: "The caption maker",
  assemble: "The video editor", final_check: "The final check", system: "The app",
};
const OPTIONAL = ["script_check", "music", "captions", "final_check"];
function friendly(e, step) {
  const pe = toProviderError(e);
  const who = WHO[step] || "Something";
  const t = {
    missing_key: [`${who} isn't connected.`, "Add its API key on the Connect AI page, or use the backup."],
    auth: [`${who} rejected the API key.`, "Check the key on the Connect AI page, or use the backup."],
    rate_limit: [`${who} is busy.`, "Wait a minute and try again, or use the backup."],
    quota: [`${who} is out of credits.`, "Top up that account, or use the backup."],
    timeout: [`${who} took too long.`, "Try again."],
    network: [`Couldn't reach ${who.toLowerCase()}.`, "Check your internet connection and try again."],
    bad_output: [`${who} gave a weird answer.`, "Try again. It usually works the second time."],
    content_blocked: [`${who} refused this content.`, "Use the backup, or make the request a bit less graphic."],
    render_failed: ["The video editor couldn't put the video together.", "Try again. If it keeps failing, redo the visuals."],
    missing_asset: ["A file this step needs went missing.", "Redo the part that made it (voice or visuals)."],
    quality_failed: [`${who}'s result didn't pass the quality check.`, "Try again for a fresh version."],
    unknown: [`Something went wrong with ${who.toLowerCase()}.`, "Try again. Details are under Advanced."],
  }[pe.code] || ["Something went wrong.", "Try again."];
  return {
    code: pe.code, message: t[0], suggestion: t[1], technical: pe.message.slice(0, 2000),
    canSkip: OPTIONAL.includes(step),
    canBackup: ["script", "script_check", "scenes", "ideas", "voice", "visuals", "captions"].includes(step),
    provider: pe.provider, at: now(),
  };
}
async function logError(projectId, videoId, step, error) {
  console.error(`[${step}]`, error.technical);
  const list = await kv.get("errors", []);
  list.unshift({ id: uid(), projectId, videoId, step, error, resolved: false, createdAt: now() });
  await kv.set("errors", list.slice(0, 200));
}
async function resolveErrors(match) {
  const list = await kv.get("errors", []);
  let n = 0;
  for (const e of list) if (!e.resolved && match(e)) (e.resolved = true), n++;
  if (n) await kv.set("errors", list);
}
