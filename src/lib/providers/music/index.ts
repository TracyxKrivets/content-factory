import { ffmpeg } from "../../ffmpeg";
import type { MusicProvider } from "../types";

/** Generated ambient beds (no API): low drones / pulses that sit under narration. */
const RECIPES: Record<string, string> = {
  "dark-drone":
    "anoisesrc=color=brown:amplitude=0.25,lowpass=f=180[n];sine=f=55,volume=0.5,tremolo=f=0.15:d=0.6[s];[n][s]amix=inputs=2,volume=0.9",
  "tense-pulse":
    "sine=f=48,volume=0.6,tremolo=f=1.6:d=0.9[a];anoisesrc=color=pink:amplitude=0.08,lowpass=f=900,tremolo=f=0.3:d=0.7[b];[a][b]amix=inputs=2",
  "eerie-tone":
    "sine=f=220,volume=0.12,vibrato=f=0.4:d=0.4[a];sine=f=233,volume=0.1[b];anoisesrc=color=brown:amplitude=0.15,lowpass=f=250[c];[a][b][c]amix=inputs=3,volume=1.2",
};

export const generatedMusic: MusicProvider = {
  id: "generated-ambience",
  label: "Generated ambience (offline)",
  capability: "music",
  offline: true,
  available: () => true,
  async make({ style, duration, outPath }) {
    const recipe = RECIPES[style] || RECIPES["dark-drone"];
    const d = Math.ceil(duration + 1);
    await ffmpeg([
      "-filter_complex",
      `${recipe},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, d - 2)}:d=2,atrim=0:${d}[out]`,
      "-map", "[out]", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", outPath,
    ]);
    return { cost: 0 };
  },
};
