import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

export function run(bin: string, args: string[], timeoutMs = 10 * 60_000, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout!.on("data", (d) => (out += d));
    p.stderr!.on("data", (d) => {
      err += d;
      if (err.length > 20000) err = err.slice(-10000);
    });
    if (input) p.stdin!.end(input);
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${bin} timed out`));
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${bin} could not start: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited ${code}: ${err.slice(-1500)}`));
    });
  });
}

/**
 * Which ffmpeg to use: FFMPEG_PATH if set, else the computer's own ffmpeg (needs the
 * subtitles/ass filter), else the copy bundled with the app (ffmpeg-static).
 */
interface Bins {
  ffmpeg: string;
  ffprobe: string;
  source: "custom" | "system" | "bundled";
  flite: boolean; // built-in robot voice available
}
const g = globalThis as any;

async function filters(bin: string) {
  try {
    return await run(bin, ["-hide_banner", "-filters"], 8000);
  } catch {
    return null;
  }
}
/** Paths of the copies installed by ffmpeg-static / ffprobe-static (resolved by hand: the
 * Next.js bundler rewrites require() calls, which broke a require-based lookup). */
function bundled(): { ffmpeg?: string; ffprobe?: string } {
  const exe = process.platform === "win32" ? ".exe" : "";
  const nm = path.join(process.cwd(), "node_modules");
  const ffmpeg = path.join(nm, "ffmpeg-static", "ffmpeg" + exe);
  const ffprobe = path.join(nm, "ffprobe-static", "bin", process.platform, process.arch, "ffprobe" + exe);
  return { ffmpeg: fs.existsSync(ffmpeg) ? ffmpeg : undefined, ffprobe: fs.existsSync(ffprobe) ? ffprobe : undefined };
}

export async function bins(): Promise<Bins> {
  if (g.__cfBins) return g.__cfBins;
  const e = env();
  let found: Bins | null = null;
  if (e.FFMPEG_PATH) {
    const f = (await filters(e.FFMPEG_PATH)) || "";
    found = { ffmpeg: e.FFMPEG_PATH, ffprobe: e.FFPROBE_PATH || "ffprobe", source: "custom", flite: / flite /.test(f) };
  } else {
    const sys = await filters("ffmpeg");
    const probeOk = await run("ffprobe", ["-version"], 5000).then(() => true, () => false);
    if (sys && / ass /.test(sys) && probeOk) found = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", source: "system", flite: / flite /.test(sys) };
    else {
      const b = bundled();
      if (b.ffmpeg && b.ffprobe) {
        const f = (await filters(b.ffmpeg)) || "";
        found = { ffmpeg: b.ffmpeg, ffprobe: b.ffprobe, source: "bundled", flite: / flite /.test(f) };
      }
    }
  }
  if (!found) throw new Error("No video editor found. Run `npm install` again, or install ffmpeg.");
  g.__cfBins = found;
  return found;
}

export const ffmpeg = async (args: string[], timeoutMs?: number) =>
  run((await bins()).ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], timeoutMs);

export async function probe(file: string) {
  const out = await run((await bins()).ffprobe, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file,
  ]);
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s: any) => s.codec_type === "video");
  return {
    duration: Number(j.format?.duration || 0),
    width: v?.width as number | undefined,
    height: v?.height as number | undefined,
    hasAudio: (j.streams || []).some((s: any) => s.codec_type === "audio"),
    hasVideo: !!v,
  };
}

export async function ffmpegAvailable(): Promise<(Bins & { error?: undefined }) | { error: string }> {
  try {
    return await bins();
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}
