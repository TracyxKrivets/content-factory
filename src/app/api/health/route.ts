import { handle } from "@/lib/api";
import { health } from "@/lib/health";

export const dynamic = "force-dynamic";
export const GET = handle(async () => health());
