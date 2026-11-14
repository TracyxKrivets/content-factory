// ---------------------------------------------------------------- UI helpers
let toastFn = () => {};
let confirmFn = async () => false;
const toast = (m, bad) => toastFn(m, bad);
const confirmBox = (o) => confirmFn(o);

/** Re-run a loader whenever stored data changes. */
function useData(loader, deps = []) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => loader().then((d) => alive && setData(d)).catch((e) => console.error(e));
    load();
    bus.addEventListener("change", load);
    return () => {
      alive = false;
      bus.removeEventListener("change", load);
    };
  }, deps);
  return data;
}
function useLive() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    bus.addEventListener("live", f);
    return () => bus.removeEventListener("live", f);
  }, []);
}
function useBlobUrl(key, tick = 0) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null, alive = true;
    if (key)
      blobs.get(key).then((b) => {
        if (b && alive) setUrl((u = URL.createObjectURL(b)));
      });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [key, tick]);
  return url;
}
// Pages switch in code, not by following links: file previewers (Claude app, phone
// file viewers) often swallow link clicks, which made the menu look dead.
let setRouteFn = null;
function go(route) {
  route = String(route).replace(/^#/, "") || "make";
  setRouteFn?.(route);
  window.scrollTo?.(0, 0);
  try {
    if (location.hash.slice(1) !== route) history.replaceState(null, "", "#" + route);
  } catch {}
}
async function downloadBlob(blob, name) {
  if (window.Capacitor?.isNativePlatform?.()) return saveNative(blob, name);
  const d = window.__cfClaude?.downloads;
  if (d) {
    try {
      await d.save({ filename: name, data: blob });
    } catch (e) {
      if (e?.code !== "declined") toast("Couldn't save the file here. Try the downloaded-file version of the app.", true);
    }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
/** Android app: save to Documents/Content Factory and open the share sheet (TikTok, Drive, Gallery…). */
async function saveNative(blob, name) {
  const { Filesystem, Share } = window.Capacitor.Plugins;
  toast("Saving…");
  try {
    const data = await blobToBase64(blob);
    const tmp = await Filesystem.writeFile({ path: name, data, directory: "CACHE" });
    let saved = false;
    try {
      await Filesystem.writeFile({ path: "Content Factory/" + name, data, directory: "DOCUMENTS", recursive: true });
      saved = true;
    } catch {}
    toast(saved ? "Saved to Documents/Content Factory ✓" : "Ready to share");
    await Share.share({ title: name, files: [tmp.uri] }).catch(() => {});
  } catch (e) {
    toast("Couldn't save the file: " + e.message, true);
  }
}
async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || "Copied 📋");
  } catch {
    toast("Couldn't copy. Your browser blocked it.", true);
  }
}
function chime(good) {
  try {
    const ctx = new AudioContext();
    (good ? [660, 880] : [440, 330]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {}
}
function Modal({ onClose, children }) {
  return html`<div class="overlay" onClick=${onClose}><div class="modal" onClick=${(e) => e.stopPropagation()}>${children}</div></div>`;
}

// ---------------------------------------------------------------- app shell
function App() {
  const [route, setRoute] = useState(() => {
    try {
      return location.hash.slice(1) || "make";
    } catch {
      return "make";
    }
  });
  setRouteFn = setRoute;
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => (window.removeEventListener("online", on), window.removeEventListener("offline", off));
  }, []);
  const [t, setT] = useState(null);
  const [c, setC] = useState(null);
  const timer = useRef();
  toastFn = (msg, bad) => {
    setT({ msg, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 3500);
  };
  confirmFn = (o) => new Promise((resolve) => setC({ ...o, resolve }));
  useEffect(() => {
    const f = () => setRoute(location.hash.slice(1) || "make");
    addEventListener("hashchange", f);
    // catch clicks on in-app links (href="#…") before anything else can
    const onClick = (e) => {
      const a = e.target.closest?.("a[href^='#']");
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      go(a.getAttribute("href"));
    };
    window.addEventListener("click", onClick, true);
    return () => {
      removeEventListener("hashchange", f);
      window.removeEventListener("click", onClick, true);
    };
  }, []);
  // warn before closing while videos are being made (they resume on reopen)
  useEffect(() => {
    const f = (e) => {
      if (window.__cfReloading) return; // the chat is reloading to apply a change
      if (running.size || queue.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  }, []);
  const close = (v) => {
    c?.resolve(v);
    setC(null);
  };
  const [name, arg] = route.split(/-(.+)/);
  const page =
    name === "project" ? html`<${ProjectPage} id=${arg} />` :
    name === "projects" ? html`<${ProjectsPage} />` :
    name === "connect" ? html`<${ConnectPage} />` :
    name === "system" ? html`<${SystemPage} />` :
    name === "money" ? html`<${MoneyPage} />` : html`<${HomePage} />`;
  return html`
    <${Nav} route=${name} />
    ${!online && html`<div class="wrap"><div class="banner warn" style="margin-top:6px"><span class="small">📡 <b>No internet.</b> Videos are paused and carry on by themselves as soon as this device is back online. Nothing is lost.</span></div></div>`}
    ${storageBlocked && html`<div class="wrap"><div class="banner bad" style="margin-top:6px">
      <span class="small"><b>Nothing will be saved here.</b> This window is blocking storage (it's probably a file preview or private window). Save the file to your computer and open it in Chrome or Edge to keep your work.</span></div></div>`}
    <main class="wrap">${page}</main>
    ${t && html`<div class=${"toast" + (t.bad ? " bad" : "")}>${t.msg}</div>`}
    ${c && html`<${Modal} onClose=${() => close(false)}>
      <h2>${c.title}</h2>${c.body && html`<p class="dim">${c.body}</p>`}
      <div class="row" style="margin-top:18px">
        <button class="btn" style="flex:1" onClick=${() => close(false)}>No, go back</button>
        <button class=${"btn " + (c.danger ? "danger" : "primary")} style="flex:1" onClick=${() => close(true)}>${c.yes}</button>
      </div>
    <//>`}`;
}

function Nav({ route }) {
  const errs = useData(() => kv.get("errors", []).then((l) => l.filter((e) => !e.resolved).length));
  useData(async () => keys.all()); // re-render when keys change
  const practice = practiceMode();
  const over = useData(async () => budget().monthly > 0 && (await monthSpend()).total >= budget().monthly);
  const L = (r, label, dot) => html`<button type="button" onClick=${() => go(r)} class=${"link" + (route === r || (r === "projects" && route === "project") ? " on" : "")}>${label}${dot && html`<span class="dot" style=${dot === "amber" ? "background:var(--amber)" : ""}></span>`}</button>`;
  return html`<nav class="nav">
    <button type="button" onClick=${() => go("make")} class="logo">CONTENT<br />FACTORY</button>
    ${L("make", "✚ Make")}${L("projects", "📁 Projects")}
    ${L("connect", "🔌 Connect AI", practice && "amber")}${L("money", "💰 Money", over && "red")}${L("system", "⚙ System", errs > 0 && "red")}<${SyncPill} />
  </nav>`;
}
