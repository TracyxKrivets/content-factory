import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { detectKey, KEY_DEFS, key, keySource, mask, saveKey, withKeys } from "@/lib/keys";

export const dynamic = "force-dynamic";

/** GET: which keys are connected (masked, never the raw key). */
export const GET = handle(async () => {
  const { id } = await currentUser();
  return withKeys(id, async () =>
    KEY_DEFS.map((d) => ({ ...d, source: keySource(d.name), masked: mask(key(d.name)) })),
  );
});

/** PUT { value, name? } — name is auto-detected when missing. value "" removes it. */
export const PUT = handle(async (req: Request) => {
  const { id } = await currentUser();
  const b = await req.json();
  const value = String(b.value || "").trim();
  const name = b.name || (value ? detectKey(value) : null);
  if (!name) throw new Error("I couldn't tell which service that key is for. Pick it from the list.");
  await saveKey(id, name, value || null);
  return { name };
});
