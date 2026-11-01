import { NextResponse } from "next/server";

/** Wrap route handlers: plain-English error JSON, technical detail in logs. */
export function handle<A extends any[]>(fn: (...a: A) => Promise<unknown>) {
  return async (...a: A) => {
    try {
      const out = await fn(...a);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e: any) {
      console.error("[api]", e?.stack || e);
      if (e?.status === 401) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
      const msg = String(e?.message || "Something went wrong.");
      const plain = /not found/i.test(msg)
        ? "That item doesn't exist anymore."
        : msg.length < 120 && !/[{}]|HTTP|ECONN|DB /.test(msg)
          ? msg
          : "Something went wrong. Check System → Error Center.";
      return NextResponse.json({ error: plain, technical: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
    }
  };
}

export type Ctx<P> = { params: Promise<P> };
