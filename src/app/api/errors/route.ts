import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { id: userId } = await currentUser();
  const all = new URL(req.url).searchParams.get("all") === "1";
  const errs = await db().list("errors", { where: { userId }, orderBy: "createdAt", desc: true, limit: 200 });
  const list = all ? errs : errs.filter((e) => !e.resolved);
  const titles: Record<string, string> = {};
  for (const e of list) {
    if (e.videoId && !titles[e.videoId]) titles[e.videoId] = (await db().get("videos", e.videoId))?.title || "";
    if (e.projectId && !titles[e.projectId]) titles[e.projectId] = (await db().get("projects", e.projectId))?.title || "";
  }
  return list.map((e) => ({ ...e, videoTitle: e.videoId ? titles[e.videoId] : null, projectTitle: e.projectId ? titles[e.projectId] : null }));
});
