import { handle, type Ctx } from "@/lib/api";
import { editScript, videoAction } from "@/lib/pipeline/projects";

export const dynamic = "force-dynamic";

/** POST { action: retry|backup|skip|regenerate, step? } */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await req.json();
  if (!["retry", "backup", "skip", "regenerate"].includes(b.action)) throw new Error("Unknown action");
  await videoAction(id, b.action, b.step);
});

/** PATCH { title, lines[], caption } — edit the script */
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await req.json();
  await editScript(id, { title: b.title, lines: Array.isArray(b.lines) ? b.lines.map(String) : [], caption: b.caption });
});
