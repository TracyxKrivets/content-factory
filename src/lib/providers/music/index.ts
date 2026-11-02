import { ffmpeg } from "../../ffmpeg";
import type { MusicProvider } from "../types";

/** Generated background beds (no API) that sit quietly under narration. */
const RECIPES: Record<string, string> = {
  // soft major chord pad
  "chill-pad":
    "sine=f=130.81,volume=0.22[a];sine=f=164.81,volume=0.16[b];sine=f=196,volume=0.14[c];sine=f=261.63,volume=0.06,tremolo=f=0.2:d=0.5[d];[a][b][c][d]amix=inputs=4,tremolo=f=0.12:d=0.3,lowpass=f=1800,volume=1.4",
  // bouncy 120bpm bass pulse + bright chord
  "upbeat-pulse":
    "sine=f=110,volume=0.6,tremolo=f=2:d=1[a];sine=f=220,volume=0.12[b];sine=f=277.18,volume=0.09[c];sine=f=329.63,volume=0.08,tremolo=f=4:d=0.6[d];[a][b][c][d]amix=inputs=4,volume=1.3",
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
    const recipe = RECIPES[style] || RECIPES["chill-pad"];
    const d = Math.ceil(duration + 1);
    await ffmpeg([
      "-filter_complex",
      `${recipe},loudnorm=I=-18:TP=-2:LRA=7,aresample=44100,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, d - 2)}:d=2,atrim=0:${d}[out]`,
      "-map", "[out]", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", outPath,
    ]);
    return { cost: 0 };
  },
};
