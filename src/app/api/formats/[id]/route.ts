import { handle, type Ctx } from "@/lib/api";
import { currentUser, own } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteFormat, duplicateFormat, updateFormat } from "@/lib/formats/service";

async function mine(params: Ctx<{ id: string }>["params"]) {
  const { id } = await params;
  const user = await currentUser();
  own(await db().get("formats", id), user.id);
  return { id, userId: user.id };
}
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id, userId } = await mine(params);
  return updateFormat(id, await req.json(), userId);
});
export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id, userId } = await mine(params);
  return deleteFormat(id, userId);
});
/** POST = duplicate */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id, userId } = await mine(params);
  return duplicateFormat(id, userId);
});
