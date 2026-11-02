"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, usePoll } from "./ui";

export function Nav() {
  const path = usePathname();
  const { data } = usePoll<{ openErrors: number; ok: boolean; offlineMode: boolean }>("/api/health", 15000);
  const { data: me } = usePoll<{ enabled: boolean; user?: { email: string | null } | null }>("/api/auth", 0, false);
  if (path === "/login") return <nav className="nav"><span className="logo">CONTENT<br />FACTORY</span></nav>;
  const on = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));
  return (
    <nav className="nav">
      <Link href="/" className="logo">
        CONTENT
        <br />
        FACTORY
      </Link>
      <Link href="/" className={"link" + (on("/") ? " on" : "")}>
        ✚ Make
      </Link>
      <Link href="/projects" className={"link" + (on("/projects") ? " on" : "")}>
        📁 Projects
      </Link>
      <Link href="/formats" className={"link" + (on("/formats") ? " on" : "")}>
        📜 Formats
      </Link>
      <Link href="/connect" className={"link" + (on("/connect") ? " on" : "")}>
        🔌 Connect AI
        {data?.offlineMode && <span className="dot" style={{ background: "var(--amber)" }} />}
      </Link>
      <Link href="/system" className={"link" + (on("/system") ? " on" : "")}>
        ⚙ System
        {data && (data.openErrors > 0 || !data.ok) && <span className="dot" />}
      </Link>
      {me?.enabled && me.user && (
        <button
          className="btn small"
          style={{ marginLeft: "auto" }}
          title={me.user.email || ""}
          onClick={async () => {
            await api("/api/auth", { body: { action: "logout" } });
            window.location.href = "/login";
          }}
        >
          Log out
        </button>
      )}
    </nav>
  );
}
