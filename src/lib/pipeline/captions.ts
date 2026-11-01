import { env } from "../env";
import type { WordTiming } from "../providers/types";
import type { CaptionStyle } from "../types";

// Builds an .ass subtitle file: 1-3 word chunks, current word highlighted.

const STYLES: Record<CaptionStyle, { size: number; primary: string; hi: string; outline: number; shadow: number; back: string; upper: boolean }> = {
  "bold-yellow": { size: 112, primary: "&H00FFFFFF", hi: "&H0000E5FF", outline: 7, shadow: 0, back: "&H80000000", upper: true },
  "clean-white": { size: 96, primary: "&H00FFFFFF", hi: "&H00C8F0FF", outline: 4, shadow: 2, back: "&H96000000", upper: false },
  "horror-red": { size: 108, primary: "&H00FFFFFF", hi: "&H001E1EE6", outline: 6, shadow: 0, back: "&H80000000", upper: true },
  glitch: { size: 100, primary: "&H00FFFFFF", hi: "&H00FFFF00", outline: 3, shadow: 5, back: "&H500000FF", upper: true },
};

const ts = (s: number) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
};
const clean = (w: string) => w.replace(/[{}\\]/g, "");

export function chunkWords(words: WordTiming[]) {
  const chunks: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  for (const w of words) {
    cur.push(w);
    const len = cur.map((c) => c.word).join(" ").length;
    if (cur.length >= 3 || len >= 16 || /[.!?,;:—]$/.test(w.word)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function buildAss(words: WordTiming[], style: CaptionStyle) {
  const s = STYLES[style] || STYLES["bold-yellow"];
  const font = env().CAPTION_FONT || "Poppins";
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${font},${s.size},${s.primary},${s.hi},&H00000000,${s.back},-1,0,0,0,100,100,1,0,1,${s.outline},${s.shadow},2,90,90,620,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  const chunks = chunkWords(words);
  chunks.forEach((chunk, ci) => {
    const chunkEnd = chunks[ci + 1]?.[0]?.start ?? chunk[chunk.length - 1].end + 0.3;
    chunk.forEach((w, wi) => {
      const start = wi === 0 ? w.start : w.start;
      const end = chunk[wi + 1]?.start ?? chunkEnd;
      const text = chunk
        .map((c, i) => {
          const t = clean(s.upper ? c.word.toUpperCase() : c.word);
          return i === wi ? `{\\c${s.hi}}${t}{\\c${s.primary}}` : t;
        })
        .join(" ");
      const pop = wi === 0 ? "{\\fscx88\\fscy88\\t(0,80,\\fscx100\\fscy100)}" : "";
      lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Main,,0,0,0,,${pop}${text}`);
    });
  });
  return head + lines.join("\n") + "\n";
}
