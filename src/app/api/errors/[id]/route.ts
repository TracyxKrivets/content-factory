import { handle, type Ctx } from "@/lib/api";
import { db } from "@/lib/db";
import { retryIdeas, videoAction } from "@/lib/pipeline/projects";
import type { StepName } from "@/lib/types";

/** POST { action: resolve | retry | backup | skip } */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const { action } = await req.json();
  const e = await db().get("errors", id);
  if (!e) throw new Error("Error not found");
  if (action !== "resolve") {
    if (e.step === "ideas" && e.projectId) await retryIdeas(e.projectId, action === "backup");
    else if (e.videoId && e.step && e.step !== "system") {
      const v = await db().get("videos", e.videoId);
      if (v?.steps[e.step as StepName]?.status === "error") await videoAction(e.videoId, action, e.step as StepName);
    } else if (e.videoId) await videoAction(e.videoId, "retry");
  }
  await db().update("errors", id, { resolved: true });
});
