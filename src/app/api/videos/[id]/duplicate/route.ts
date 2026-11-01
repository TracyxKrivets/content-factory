import { handle, type Ctx } from "@/lib/api";
import { currentUser, own } from "@/lib/auth";
import { db } from "@/lib/db";
import { duplicateVideo } from "@/lib/pipeline/projects";

export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  own(await db().get("videos", id), (await currentUser()).id);
  const v = await duplicateVideo(id);
  return { id: v.id };
});
