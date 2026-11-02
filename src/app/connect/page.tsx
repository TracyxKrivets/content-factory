"use client";
import Link from "next/link";
import { ConnectAI } from "@/components/ConnectAI";

export default function Connect() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginTop: 16 }}>🔌 Connect AI</h1>
      <p className="dim" style={{ marginTop: 0 }}>
        Paste a key from any of these. <b>One is enough to start</b>; more means better voices and pictures. Without keys the app still works in practice mode.
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <b>Quickest setup:</b>
        <ol className="small" style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Click <b>Get a key ↗</b> next to a service and create a key on their site.</li>
          <li>Copy it, paste it below and press <b>SAVE KEY</b>.</li>
          <li>Green dot = working. Go make videos.</li>
        </ol>
      </div>
      <ConnectAI />
      <Link href="/" className="btn primary" style={{ width: "100%", marginTop: 18 }}>
        DONE: MAKE VIDEOS
      </Link>
    </div>
  );
}
