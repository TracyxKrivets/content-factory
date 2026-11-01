import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createProject } from "@/lib/pipeline/projects";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { id: userId } = await currentUser();
  const trash = new URL(req.url).searchParams.get("trash") === "1";
  const projects = (await db().list("projects", { where: { userId }, orderBy: "createdAt", desc: true }))
    .filter((p) => (trash ? !!p.deletedAt : !p.deletedAt));
  const videos = await db().list("videos", { where: { userId } });
  return projects.map((p) => {
    const vs = videos.filter((v) => v.projectId === p.id);
    const thumb = vs.find((v) => v.steps.visuals.output?.images?.[0])?.steps.visuals.output.images[0];
    return {
      id: p.id, title: p.title, request: p.request, status: p.status, format: { name: p.format.name, emoji: p.format.emoji },
      createdAt: p.createdAt, updatedAt: p.updatedAt, deletedAt: p.deletedAt,
      total: p.settings.count > vs.length ? p.settings.count : vs.length,
      done: vs.filter((v) => v.status === "done").length,
      problems: vs.filter((v) => v.status === "needs_attention").length + (p.ideaError ? 1 : 0),
      thumb: thumb || null,
    };
  });
});

export const POST = handle(async (req: Request) => {
  const { id: userId } = await currentUser();
  const b = await req.json();
  const p = await createProject({
    request: String(b.request || ""),
    formatId: b.formatId || null,
    count: b.count ? Number(b.count) : null,
    lengthSec: b.lengthSec ? Number(b.lengthSec) : null,
    language: b.language || null,
    userId,
  });
  return { id: p.id };
});
