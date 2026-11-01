import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { health } from "@/lib/health";
import { withKeys } from "@/lib/keys";

export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const { id } = await currentUser();
  return withKeys(id, () => health(id));
});
