"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Confirm = { title: string; body?: string; yes: string; danger?: boolean; resolve: (v: boolean) => void };
const Ctx = createContext<{
  toast: (msg: string, bad?: boolean) => void;
  confirm: (o: Omit<Confirm, "resolve">) => Promise<boolean>;
}>({ toast: () => {}, confirm: async () => false });

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; bad?: boolean } | null>(null);
  const [c, setC] = useState<Confirm | null>(null);
  const timer = useRef<any>(null);
  const toast = useCallback((msg: string, bad?: boolean) => {
    setT({ msg, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 3500);
  }, []);
  const confirm = useCallback((o: Omit<Confirm, "resolve">) => new Promise<boolean>((resolve) => setC({ ...o, resolve })), []);
  const close = (v: boolean) => {
    c?.resolve(v);
    setC(null);
  };
  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      {t && <div className={"toast" + (t.bad ? " bad" : "")}>{t.msg}</div>}
      {c && (
        <div className="overlay" onClick={() => close(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{c.title}</h2>
            {c.body && <p className="dim">{c.body}</p>}
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => close(false)}>
                No, go back
              </button>
              <button className={"btn " + (c.danger ? "danger" : "primary")} style={{ flex: 1 }} onClick={() => close(true)}>
                {c.yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
export const useUi = () => useContext(Ctx);

/** fetch JSON; throws Error with the server's plain-English message */
export async function api<T = any>(url: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Couldn't reach the app. Is it running?");
  return j as T;
}

/** Poll a URL; pauses while the tab is hidden. */
export function usePoll<T>(url: string | null, ms: number, active = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [url]);
  useEffect(() => {
    load();
    if (!active) return;
    const id = setInterval(() => document.visibilityState === "visible" && load(), ms);
    return () => clearInterval(id);
  }, [load, ms, active]);
  return { data, error, reload: load };
}

export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export const fileUrl = (key: string, download?: string) =>
  `/api/files/${key.split("/").map(encodeURIComponent).join("/")}${download ? `?download=${encodeURIComponent(download)}` : ""}`;

export const money = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
