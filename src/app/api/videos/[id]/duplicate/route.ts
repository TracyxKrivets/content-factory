import { handle, type Ctx } from "@/lib/api";
import { duplicateVideo } from "@/lib/pipeline/projects";

export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const v = await duplicateVideo(id);
  return { id: v.id };
});
