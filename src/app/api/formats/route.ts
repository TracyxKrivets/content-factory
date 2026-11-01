import { handle } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { createFormat, listFormats } from "@/lib/formats/service";

export const dynamic = "force-dynamic";
export const GET = handle(async () => listFormats((await currentUser()).id));
export const POST = handle(async (req: Request) => createFormat(await req.json(), (await currentUser()).id));
