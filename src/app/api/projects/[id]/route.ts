import { handle, type Ctx } from "@/lib/api";
import { addVideos, deleteProject, getProjectFull, restoreProject, retryIdeas } from "@/lib/pipeline/projects";
import { providerLabel, isOffline } from "@/lib/providers";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const full = await getProjectFull(id);
  if (!full) throw new Error("Project not found");
  // attach friendly provider labels for the UI
  const labels: Record<string, { label: string; offline: boolean }> = {};
  for (const v of full.videos)
    for (const s of Object.values(v.steps))
      for (const pid of String(s.provider || "").split(", ").filter(Boolean))
        labels[pid] = { label: pid === "edited" ? "Edited by you" : providerLabel(pid), offline: isOffline(pid) };
  return { ...full, labels };
});

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await req.json();
  switch (b.action) {
    case "delete": return deleteProject(id);
    case "restore": return restoreProject(id);
    case "retry_ideas": return retryIdeas(id, !!b.backup);
    case "add_videos": return addVideos(id, Number(b.count) || 1);
    default: throw new Error("Unknown action");
  }
});
