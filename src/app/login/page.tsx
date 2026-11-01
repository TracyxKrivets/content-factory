"use client";
import { useState } from "react";
import { api } from "@/components/ui";

export default function Login() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ confirm?: boolean }>("/api/auth", { body: { action: mode, email, password } });
      if (r.confirm) {
        setMsg({ text: "Almost there. Check your email and click the link, then log in." });
        setMode("login");
      } else window.location.href = "/";
    } catch (err: any) {
      setMsg({ text: err.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 14 }}>
      <h1 className="pixel" style={{ fontSize: 20, lineHeight: 1.6 }}>
        {mode === "login" ? "Welcome back" : "Make an account"}
      </h1>
      <div>
        <label className="lbl">Email</label>
        <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="lbl">Password</label>
        <input
          className="input"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {msg && <div className={"banner " + (msg.bad ? "bad" : "good")}>{msg.text}</div>}
      <button className="btn primary huge" disabled={busy} type="submit">
        {busy ? "…" : mode === "login" ? "LOG IN" : "SIGN UP"}
      </button>
      <button type="button" className="btn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "New here? Make an account" : "Already have an account? Log in"}
      </button>
    </form>
  );
}
