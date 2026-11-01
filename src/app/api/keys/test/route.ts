import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { key, testKey, withKeys, type KeyName } from "@/lib/keys";

export const dynamic = "force-dynamic";

/** POST { name } — tests the saved (or env) key for that service. */
export const POST = handle(async (req: Request) => {
  const { id } = await currentUser();
  const { name } = await req.json();
  return withKeys(id, async () => {
    const v = key(name as KeyName);
    if (!v) return { ok: false, message: "No key saved yet." };
    return testKey(name as KeyName, v);
  });
});
