import type { Capability, Format } from "../types";

export type Tier = "cheap" | "quality";
export type LlmTask = "ideas" | "script" | "rewrite" | "check" | "scenes";

interface Base {
  id: string;
  label: string;
  capability: Capability;
  /** offline providers run locally with no API — used only when nothing else is available or as a backup */
  offline?: boolean;
  available(): boolean;
}

export interface LlmRequest {
  task: LlmTask;
  tier: Tier;
  system: string;
  prompt: string;
  maxTokens: number;
  /** structured input — used by the offline writer, ignored by real models */
  input: any;
}
export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}
export interface LlmProvider extends Base {
  capability: "llm";
  complete(req: LlmRequest): Promise<LlmResult>;
}

export interface VoiceProvider extends Base {
  capability: "voice";
  /** writes audio to outPath (mp3); returns cost */
  speak(req: { text: string; style: string; language: string; outPath: string }): Promise<{ cost: number; units: number }>;
}

export interface ImageProvider extends Base {
  capability: "image";
  generate(req: {
    prompt: string;
    search: string;
    text: string;
    format: Format;
    outPath: string; // provider may change extension; returns real path
    avoid: string[]; // ids already used in this video (stock providers)
  }): Promise<{ cost: number; path: string; sourceId?: string }>;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}
export interface CaptionProvider extends Base {
  capability: "captions";
  timings(req: { audioPath: string; text: string; duration: number }): Promise<{ words: WordTiming[]; cost: number }>;
}

export interface MusicProvider extends Base {
  capability: "music";
  make(req: { style: Format["musicStyle"]; duration: number; outPath: string }): Promise<{ cost: number }>;
}

export type AnyProvider = LlmProvider | VoiceProvider | ImageProvider | CaptionProvider | MusicProvider;
