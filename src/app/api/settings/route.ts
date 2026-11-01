import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { providerOrder } from "@/lib/providers";
import { now } from "@/lib/util";

export const dynamic = "force-dynamic";
export const GET = handle(async () => ({ providerOrder: await providerOrder((await currentUser()).id) }));
export const PUT = handle(async (req: Request) => {
  const { id: userId } = await currentUser();
  const { providerOrder: order } = await req.json();
  const id = `settings-${userId}`;
  const existing = await db().get("settings", id);
  if (existing) await db().update("settings", id, { providerOrder: order || {} });
  else {
    const t = now();
    await db().insert("settings", { id, userId, providerOrder: order || {}, createdAt: t, updatedAt: t });
  }
});
