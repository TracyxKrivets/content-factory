import { db } from "../db";
import type { Capability } from "../types";
import { LOCAL_USER } from "../util";
import { estimatedCaptions, whisperCaptions } from "./captions";
import { offlineImage, openaiImage, pexelsImage } from "./image";
import { anthropicLlm } from "./llm/anthropic";
import { offlineLlm } from "./llm/offline";
import { openaiLlm } from "./llm/openai";
import { generatedMusic } from "./music";
import type { AnyProvider, CaptionProvider, ImageProvider, LlmProvider, MusicProvider, VoiceProvider } from "./types";
import { elevenlabsVoice, offlineVoice, openaiVoice } from "./voice";

/**
 * Provider registry. To add a provider: write an adapter implementing the interface in ./types
 * and add it to the right list here. Order = default priority.
 */
export const REGISTRY = {
  llm: [anthropicLlm, openaiLlm, offlineLlm] as LlmProvider[],
  voice: [elevenlabsVoice, openaiVoice, offlineVoice] as VoiceProvider[],
  image: [openaiImage, pexelsImage, offlineImage] as ImageProvider[],
  captions: [estimatedCaptions, whisperCaptions] as CaptionProvider[],
  music: [generatedMusic] as MusicProvider[],
} satisfies Record<Capability, AnyProvider[]>;

type ProviderOf<C extends Capability> = (typeof REGISTRY)[C][number];

/** Circuit breaker: providers that just failed hard are tried last for a few minutes. */
const g = globalThis as any;
g.__cfDown ??= new Map<string, number>();
export function markDown(id: string, ms = 5 * 60_000) {
  g.__cfDown.set(id, Date.now() + ms);
}
export function markUp(id: string) {
  g.__cfDown.delete(id);
}
const isDown = (id: string) => (g.__cfDown.get(id) || 0) > Date.now();
export const downProviders = () => [...g.__cfDown.entries()].filter(([, t]) => t > Date.now()).map(([id]) => id as string);

export async function providerOrder(userId = LOCAL_USER) {
  const s = await db().get("settings", `settings-${userId}`).catch(() => null);
  return s?.providerOrder || {};
}

/**
 * Ordered list of providers to try for a capability.
 * - preferred (project override) first, then saved order, then registry order
 * - providers in `avoid` (failed + user pressed "Use backup") are dropped
 * - offline providers are used only when no non-avoided online provider is available,
 *   unless explicitly preferred
 */
export async function chain<C extends Capability>(
  cap: C,
  opts: { preferred?: string; avoid?: string[]; userId?: string } = {},
): Promise<ProviderOf<C>[]> {
  const all = REGISTRY[cap] as ProviderOf<C>[];
  const saved: string[] = (await providerOrder(opts.userId))[cap] || [];
  const rank = (p: AnyProvider) => {
    if (p.id === opts.preferred) return -1;
    const i = saved.indexOf(p.id);
    return (i >= 0 ? i : 100 + all.indexOf(p as any)) + (isDown(p.id) ? 1000 : 0);
  };
  const usable = all
    .filter((p) => p.available() && !(opts.avoid || []).includes(p.id))
    .sort((a, b) => rank(a) - rank(b));
  const online = usable.filter((p) => !p.offline);
  const preferredOffline = usable.find((p) => p.offline && p.id === opts.preferred);
  if (cap === "captions" || cap === "music") return usable; // offline-first is fine here
  if (preferredOffline) return [preferredOffline, ...online];
  if (online.length) return online;
  return usable.filter((p) => p.offline);
}

export function providerSummary() {
  return (Object.keys(REGISTRY) as Capability[]).map((cap) => ({
    capability: cap,
    providers: REGISTRY[cap].map((p) => ({
      id: p.id,
      label: p.label,
      offline: !!p.offline,
      available: p.available(),
    })),
    hasOnline: REGISTRY[cap].some((p) => !p.offline && p.available()),
  }));
}

export function providerLabel(id?: string) {
  for (const list of Object.values(REGISTRY)) for (const p of list) if (p.id === id) return p.label;
  return id || "";
}
/** true for offline stand-ins that lower quality (writer, voice, visuals). Free captions/music are fine. */
export function isOffline(id?: string) {
  for (const cap of ["llm", "voice", "image"] as const)
    for (const p of REGISTRY[cap]) if (p.id === id) return !!p.offline;
  return false;
}
