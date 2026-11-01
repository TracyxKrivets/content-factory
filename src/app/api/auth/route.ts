import { NextResponse } from "next/server";
import { authEnabled, currentUser, supabaseServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET: who am I. POST {action: login|signup|logout, email, password} */
export async function GET() {
  if (!authEnabled()) return NextResponse.json({ enabled: false });
  try {
    const u = await currentUser();
    return NextResponse.json({ enabled: true, user: u });
  } catch {
    return NextResponse.json({ enabled: true, user: null });
  }
}

export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const { action, email, password } = await req.json().catch(() => ({}));
  const sb = await supabaseServer();
  if (action === "logout") {
    await sb.auth.signOut();
    return NextResponse.json({ ok: true });
  }
  const e = String(email || "").trim();
  const p = String(password || "");
  if (!e.includes("@")) return NextResponse.json({ error: "Type your email." }, { status: 400 });
  if (p.length < 6) return NextResponse.json({ error: "Password needs at least 6 characters." }, { status: 400 });

  if (action === "signup") {
    const { data, error } = await sb.auth.signUp({ email: e, password: p });
    if (error) return NextResponse.json({ error: friendlyAuth(error.message) }, { status: 400 });
    if (!data.session) return NextResponse.json({ ok: true, confirm: true });
    return NextResponse.json({ ok: true });
  }
  const { error } = await sb.auth.signInWithPassword({ email: e, password: p });
  if (error) return NextResponse.json({ error: friendlyAuth(error.message) }, { status: 400 });
  return NextResponse.json({ ok: true });
}

function friendlyAuth(m: string) {
  if (/invalid login|invalid credentials/i.test(m)) return "Wrong email or password.";
  if (/already registered|already exists/i.test(m)) return "That email already has an account. Log in instead.";
  if (/not confirmed/i.test(m)) return "Confirm your email first (check your inbox).";
  if (/rate limit/i.test(m)) return "Too many tries. Wait a minute.";
  return "Couldn't log in. Try again.";
}
