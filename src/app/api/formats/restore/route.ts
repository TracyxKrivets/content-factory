import { handle } from "@/lib/api";
import { restoreStarters } from "@/lib/formats/service";

export const POST = handle(async () => restoreStarters());
