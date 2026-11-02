// archiver v8: class API
import * as archiverNs from "archiver";
const ZipArchive = (archiverNs as any).ZipArchive as new (o: { store?: boolean }) => import("archiver").Archiver;
import fs from "node:fs";
import { PassThrough, Readable } from "node:stream";
import type { Ctx } from "@/lib/api";
import { currentUser, own } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureLocal } from "@/lib/storage";
import type { Script } from "@/lib/types";

export const dynamic = "force-dynamic";

const safe = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "video";

/** GET: every finished video in the project + captions.txt, as one ZIP download. */
export async function GET(_req: Request, { params }: Ctx<{ id: string }>) {
  try {
    const { id } = await params;
    const project = own(await db().get("projects", id), (await currentUser()).id);
    const videos = (await db().list("videos", { where: { projectId: id } }))
      .filter((v) => v.status === "done" && v.steps.assemble.output?.key)
      .sort((a, b) => a.index - b.index);
    if (!videos.length) return Response.json({ error: "No finished videos yet." }, { status: 400 });

    const files = await Promise.all(videos.map((v) => ensureLocal(v.steps.assemble.output.key)));
    const zip = new ZipArchive({ store: true }); // mp4s are already compressed
    const out = new PassThrough();
    zip.pipe(out);
    let captions = `${project.title}\n${"=".repeat(project.title.length)}\n\n`;
    videos.forEach((v, i) => {
      const n = String(i + 1).padStart(2, "0");
      zip.append(fs.createReadStream(files[i]), { name: `${n}-${safe(v.title)}.mp4` });
      const s: Script | undefined = v.steps.script.output;
      captions += `${n}. ${v.title}\n${s?.caption || ""}\n${(s?.hashtags || []).join(" ")}\n\n`;
    });
    zip.append(captions, { name: "captions.txt" });
    void zip.finalize();
    return new Response(Readable.toWeb(out) as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safe(project.title)}.zip"`,
      },
    });
  } catch (e: any) {
    const status = e?.status === 401 ? 401 : /not found/i.test(e?.message) ? 404 : 500;
    return Response.json({ error: status === 404 ? "That project doesn't exist." : "Couldn't make the ZIP. Try again." }, { status });
  }
}
