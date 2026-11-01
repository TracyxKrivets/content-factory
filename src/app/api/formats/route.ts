import { handle } from "@/lib/api";
import { createFormat, listFormats } from "@/lib/formats/service";

export const dynamic = "force-dynamic";
export const GET = handle(async () => listFormats());
export const POST = handle(async (req: Request) => createFormat(await req.json()));
