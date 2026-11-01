import fs from "node:fs/promises";
import { env } from "../../env";
import { httpError, ProviderError } from "../../errors";
import { PRICE } from "../pricing";
import type { CaptionProvider, WordTiming } from "../types";

/** Free: spread words across the audio by character length (pauses at punctuation). */
export const estimatedCaptions: CaptionProvider = {
  id: "estimated",
  label: "Estimated timing (free)",
  capability: "captions",
  offline: true,
  available: () => true,
  async timings({ text, duration }) {
    const words = text.split(/\s+/).filter(Boolean);
    const weight = (w: string) => w.length + 2 + (/[.!?]$/.test(w) ? 6 : /[,;:—]$/.test(w) ? 3 : 0);
    const total = words.reduce((s, w) => s + weight(w), 0) || 1;
    const lead = Math.min(0.2, duration * 0.02);
    const usable = Math.max(0.5, duration - lead - 0.15);
    let t = lead;
    const out: WordTiming[] = words.map((w) => {
      const d = (weight(w) / total) * usable;
      const wt = { word: w, start: t, end: t + d };
      t += d;
      return wt;
    });
    return { words: out, cost: 0 };
  },
};

/** Exact word timing via OpenAI transcription. */
export const whisperCaptions: CaptionProvider = {
  id: "openai-whisper",
  label: "OpenAI exact timing",
  capability: "captions",
  available: () => !!env().OPENAI_API_KEY,
  async timings({ audioPath, duration }) {
    const key = env().OPENAI_API_KEY;
    if (!key) throw new ProviderError("missing_key", "OPENAI_API_KEY not set", { provider: "openai-whisper" });
    const form = new FormData();
    form.append("file", new Blob([await fs.readFile(audioPath)]), "voice.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw await httpError(res, "openai-whisper");
    const j = await res.json();
    const words: WordTiming[] = (j.words || []).map((w: any) => ({ word: w.word, start: w.start, end: w.end }));
    if (!words.length) throw new ProviderError("bad_output", "No word timings returned", { provider: "openai-whisper" });
    return { words, cost: (duration / 60) * PRICE.whisperPerMinute };
  },
};
