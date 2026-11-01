import { handle, type Ctx } from "@/lib/api";
import { deleteFormat, duplicateFormat, updateFormat } from "@/lib/formats/service";

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) =>
  updateFormat((await params).id, await req.json()),
);
export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => deleteFormat((await params).id));
/** POST = duplicate */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => duplicateFormat((await params).id));
