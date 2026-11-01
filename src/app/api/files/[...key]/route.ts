import fs from "node:fs";
import { Readable } from "node:stream";
import { contentType, ensureLocal } from "@/lib/storage";
import type { Ctx } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Serves assets with HTTP range support (video seeking). ?download=name forces a download. */
export async function GET(req: Request, { params }: Ctx<{ key: string[] }>) {
  const { key } = await params;
  const k = key.map(decodeURIComponent).join("/");
  if (k.includes("..")) return new Response("Bad path", { status: 400 });
  let file: string;
  try {
    file = await ensureLocal(k);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": contentType(k),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  const dl = new URL(req.url).searchParams.get("download");
  if (dl) headers["Content-Disposition"] = `attachment; filename="${dl.replace(/[^\w.-]+/g, "_")}"`;
  const range = req.headers.get("range");
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as any, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as any, { headers: { ...headers, "Content-Length": String(size) } });
}
