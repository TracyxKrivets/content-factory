import { ffmpeg, probe } from "../ffmpeg";

/**
 * Video rendering adapter. ffmpeg is the default; a cloud renderer (Shotstack, Creatomate, ...)
 * can implement the same interface and be swapped in via RENDERERS.
 */
export interface RenderInput {
  images: string[]; // local paths, one per scene
  sceneWeights: number[]; // relative scene lengths (e.g. chars per line)
  voicePath: string;
  voiceDuration: number;
  musicPath?: string;
  captionsPath?: string;
  outPath: string;
}
export interface Renderer {
  id: string;
  label: string;
  render(i: RenderInput): Promise<{ duration: number }>;
}

const W = 1080;
const H = 1920;
const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

export const ffmpegRenderer: Renderer = {
  id: "ffmpeg",
  label: "Built-in editor (ffmpeg)",
  async render(i) {
    const n = i.images.length;
    if (!n) throw new Error("No visuals to render");
    const total = i.voiceDuration + 0.8;
    const wsum = i.sceneWeights.reduce((a, b) => a + b, 0) || n;
    const durs = i.sceneWeights.map((w) => Math.max(0.8, (w / wsum) * i.voiceDuration));
    durs[n - 1] += total - durs.reduce((a, b) => a + b, 0); // absorb rounding + tail
    if (durs[n - 1] < 0.5) durs[n - 1] = 0.5;

    const args: string[] = [];
    i.images.forEach((img, k) => args.push("-loop", "1", "-t", durs[k].toFixed(3), "-i", img));
    args.push("-i", i.voicePath);
    if (i.musicPath) args.push("-i", i.musicPath);

    const sw = Math.round(W * 1.12);
    const sh = Math.round(H * 1.12);
    const f: string[] = [];
    i.images.forEach((_, k) => {
      const d = durs[k].toFixed(3);
      // slow Ken Burns pan, alternating direction
      const x = k % 2 === 0 ? `(iw-ow)*t/${d}` : `(iw-ow)*(1-t/${d})`;
      const y = k % 3 === 0 ? `(ih-oh)*t/${d}` : `(ih-oh)/2`;
      f.push(
        `[${k}:v]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},setsar=1,fps=30,` +
          `crop=${W}:${H}:x='${x}':y='${y}',format=yuv420p[v${k}]`,
      );
    });
    f.push(`${i.images.map((_, k) => `[v${k}]`).join("")}concat=n=${n}:v=1:a=0[vc]`);
    let v = "[vc]";
    f.push(`${v}fade=t=in:st=0:d=0.3,fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5[vf]`);
    v = "[vf]";
    if (i.captionsPath) {
      f.push(`${v}ass=filename='${esc(i.captionsPath)}'[vs]`);
      v = "[vs]";
    }
    const va = `${n}:a`;
    if (i.musicPath) {
      f.push(`[${va}]volume=1.0[a0];[${n + 1}:a]volume=0.3[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0,apad[aout]`);
    } else f.push(`[${va}]apad[aout]`);

    args.push(
      "-filter_complex", f.join(";"),
      "-map", v, "-map", "[aout]",
      "-t", total.toFixed(3),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", "30",
      "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
      "-movflags", "+faststart",
      i.outPath,
    );
    await ffmpeg(args, 15 * 60_000);
    const p = await probe(i.outPath);
    return { duration: p.duration };
  },
};

export const RENDERERS: Renderer[] = [ffmpegRenderer];
export const renderer = () => RENDERERS[0];
