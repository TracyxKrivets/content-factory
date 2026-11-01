import { key as apiKey } from "../../keys";
import fs from "node:fs/promises";
import { env } from "../../env";
import { httpError, ProviderError } from "../../errors";
import { ffmpeg } from "../../ffmpeg";
import { hash } from "../../util";
import { PRICE } from "../pricing";
import type { ImageProvider } from "../types";

export const openaiImage: ImageProvider = {
  id: "openai-image",
  label: "OpenAI images",
  capability: "image",
  available: () => !!apiKey("OPENAI_API_KEY"),
  async generate({ prompt, outPath }) {
    const key = apiKey("OPENAI_API_KEY");
    if (!key) throw new ProviderError("missing_key", "OPENAI_API_KEY not set", { provider: "openai-image" });
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: env().OPENAI_IMAGE_MODEL || "gpt-image-2",
        prompt: `${prompt}. Vertical 9:16 cinematic frame, no text, no watermark.`,
        size: "1024x1536",
        quality: "medium",
        n: 1,
      }),
    });
    if (!res.ok) throw await httpError(res, "openai-image");
    const j = await res.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("bad_output", "No image returned", { provider: "openai-image" });
    const path = outPath.replace(/\.\w+$/, ".png");
    await fs.writeFile(path, Buffer.from(b64, "base64"));
    return { cost: PRICE.openaiImage, path };
  },
};

export const pexelsImage: ImageProvider = {
  id: "pexels",
  label: "Pexels stock photos",
  capability: "image",
  available: () => !!apiKey("PEXELS_API_KEY"),
  async generate({ search, format, outPath, avoid }) {
    const key = apiKey("PEXELS_API_KEY");
    if (!key) throw new ProviderError("missing_key", "PEXELS_API_KEY not set", { provider: "pexels" });
    const queries = [search, `${search} dark`, format.visualStyle.split(",")[0]];
    for (const q of queries) {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=portrait&per_page=20`,
        { headers: { Authorization: key }, signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) throw await httpError(res, "pexels");
      const photos: any[] = (await res.json()).photos || [];
      const pick = photos.find((p) => !avoid.includes(String(p.id)));
      if (!pick) continue;
      const img = await fetch(pick.src.portrait || pick.src.large2x, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw await httpError(img, "pexels");
      const path = outPath.replace(/\.\w+$/, ".jpg");
      await fs.writeFile(path, Buffer.from(await img.arrayBuffer()));
      return { cost: 0, path, sourceId: String(pick.id) };
    }
    throw new ProviderError("bad_output", `No stock photos for "${search}"`, { provider: "pexels" });
  },
};

/** Offline title card: moody gradient + grain + keywords. */
export const offlineImage: ImageProvider = {
  id: "offline-cards",
  label: "Title cards (offline)",
  capability: "image",
  offline: true,
  available: () => true,
  async generate({ search, text, format, outPath }) {
    const h = parseInt(hash(format.visualStyle, search).slice(0, 6), 16);
    const hue = h % 360;
    const c1 = hsl(hue, 50, 20);
    const c2 = hsl((hue + 30) % 360, 30, 4);
    const label = wrap(search.toUpperCase().slice(0, 48), 16).slice(0, 3).join("\n");
    const lbl = outPath + ".label.txt";
    await fs.writeFile(lbl, label);
    const e = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const font = env().CAPTION_FONT || "Poppins";
    const path = outPath.replace(/\.\w+$/, ".png");
    await ffmpeg([
      "-f", "lavfi", "-i", `gradients=s=1080x1920:c0=${c1}:c1=${c2}:x0=540:y0=0:x1=540:y1=1920:d=1`,
      "-vf",
      [
        "noise=alls=22:allf=t",
        "vignette=PI/3",
        `drawbox=x=140:y=ih*0.22:w=800:h=4:color=white@0.25:t=fill`,
        `drawtext=font='${font}':textfile='${e(lbl)}':fontsize=84:fontcolor=white@0.8:line_spacing=18:x=(w-tw)/2:y=h*0.25`,
        `drawbox=x=140:y=ih*0.25+${label.split("\n").length * 102 + 30}:w=800:h=4:color=white@0.25:t=fill`,
      ].join(","),
      "-frames:v", "1", path,
    ]);
    await fs.rm(lbl, { force: true });
    return { cost: 0, path };
  },
};

function hsl(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return "0x" + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function wrap(t: string, n: number) {
  const out: string[] = [];
  let line = "";
  for (const w of t.split(/\s+/)) {
    if ((line + " " + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
