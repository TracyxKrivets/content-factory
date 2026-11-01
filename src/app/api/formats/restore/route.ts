import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { restoreStarters } from "@/lib/formats/service";

export const POST = handle(async () => restoreStarters((await currentUser()).id));
