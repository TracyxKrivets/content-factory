import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { providerOrder } from "@/lib/providers";
import { LOCAL_USER, now } from "@/lib/util";

export const dynamic = "force-dynamic";
export const GET = handle(async () => ({ providerOrder: await providerOrder() }));
export const PUT = handle(async (req: Request) => {
  const { providerOrder: order } = await req.json();
  const id = `settings-${LOCAL_USER}`;
  const existing = await db().get("settings", id);
  if (existing) await db().update("settings", id, { providerOrder: order || {} });
  else {
    const t = now();
    await db().insert("settings", { id, userId: LOCAL_USER, providerOrder: order || {}, createdAt: t, updatedAt: t });
  }
});
