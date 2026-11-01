import { spawn } from "node:child_process";
import { ffmpegBin, ffprobeBin } from "./env";

export function run(bin: string, args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => {
      err += d;
      if (err.length > 20000) err = err.slice(-10000);
    });
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

export const ffmpeg = (args: string[], timeoutMs?: number) =>
  run(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", ...args], timeoutMs);

export async function probe(file: string) {
  const out = await run(ffprobeBin(), [
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

export async function ffmpegAvailable() {
  try {
    await run(ffmpegBin(), ["-version"], 5000);
    await run(ffprobeBin(), ["-version"], 5000);
    return true;
  } catch {
    return false;
  }
}
