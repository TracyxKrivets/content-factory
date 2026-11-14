// ---------------------------------------------------------------- sync screens: set up, pair a phone, devices
function useSync() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    bus.addEventListener("sync", f);
    bus.addEventListener("change", f);
    const t = setInterval(f, 30000); // "online 2 min ago" stays fresh
    return () => (bus.removeEventListener("sync", f), bus.removeEventListener("change", f), clearInterval(t));
  }, []);
  return Sync.st;
}
const seenAgo = (iso) => {
  const s = (Date.now() - Date.parse(iso || 0)) / 1000;
  return s < 90 ? "online now" : s < 3600 ? `seen ${Math.round(s / 60)} min ago` : s < 86400 ? `seen ${Math.round(s / 3600)} h ago` : `seen ${Math.round(s / 86400)} days ago`;
};

/** Little light in the menu: green = live, amber = connecting / waiting to send. */
function SyncPill() {
  const st = useSync();
  if (st.status === "off") return null;
  const ok = st.status === "online" && !st.pending && !st.error;
  const word = st.status === "online" ? (st.pending ? "Sending…" : "Synced") : st.status === "signed-out" ? "Sign in" : st.status === "error" ? "Sync problem" : "Connecting…";
  return html`<button type="button" class="link syncpill" title=${st.error || word} onClick=${() => go("connect")}><span class="sdot" style=${`background:${ok ? "var(--green)" : st.status === "error" ? "var(--red)" : "var(--amber)"}`}></span>${word}</button>`;
}

function QrCode({ text, size = 200 }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return html`<div class="qr" style=${`width:${size}px;height:${size}px`} dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

/** Camera scanner for the pairing QR code (phone). */
function Scanner({ onCode, onClose }) {
  const vid = useRef(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stream, alive = true, t;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        vid.current.srcObject = stream;
        await vid.current.play();
        const c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          if (!alive) return;
          const v = vid.current;
          if (v.videoWidth) {
            c.width = 480;
            c.height = Math.round((480 * v.videoHeight) / v.videoWidth);
            g.drawImage(v, 0, 0, c.width, c.height);
            const r = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
            if (r?.data && Sync.readPair(r.data)) return onCode(r.data);
          }
          t = setTimeout(tick, 220);
        };
        tick();
      } catch (e) {
        setErr("Couldn't open the camera. Allow camera access, or paste the code instead.");
      }
    })();
    return () => {
      alive = false;
      clearTimeout(t);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, []);
  return html`<${Modal} onClose=${onClose}>
    <h2>📷 Scan the code on your PC</h2>
    <p class="small dim">On your PC: 🔌 Connect AI → Sync your devices → the QR code.</p>
    ${err ? html`<p class="small" style="color:#ffe0a0">${err}</p>` : html`<video ref=${vid} playsinline muted style="width:100%;border-radius:12px;background:#000"></video>`}
    <button class="btn" style="width:100%;margin-top:10px" onClick=${onClose}>Cancel</button>
  <//>`;
}

function SyncCard() {
  const st = useSync();
  const c = Sync.cfg();
  const [mode, setMode] = useState(c.url ? "account" : "");
  const [url, setUrl] = useState(c.url);
  const [anon, setAnon] = useState(c.anon);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [scan, setScan] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg("⚠️ " + e.message);
    } finally {
      setBusy(false);
    }
  };
  const usePair = async (text) => {
    const p = Sync.readPair(text);
    if (!p?.url || !p?.anon) return setMsg("⚠️ That isn't a pairing code. On your PC it's under Sync your devices.");
    setScan(false);
    setUrl(p.url);
    setAnon(p.anon);
    await run(async () => {
      await Sync.setup(p);
      setMode("account");
    });
  };
  const live = st.user && st.status !== "off";
  if (!canFetch())
    return html`<div class="card syncard" style="margin:14px 0 18px"><label class="lbl" style="margin:0 0 6px">📱 Sync your devices</label>
      <p class="small dim" style="margin:0">Syncing your phone and PC works in the Windows and Android apps (inside Claude, the page can't reach outside services).</p></div>`;
  const devices = Object.entries(st.devices).sort((a, b) => (a[0] === Sync.me.id ? -1 : b[0] === Sync.me.id ? 1 : 0));

  return html`<div class="card syncard" style="margin:14px 0 18px">
    <label class="lbl" style="margin:0 0 6px">📱 Sync your devices <span class="small dim">(phone + PC, live, on Wi-Fi or mobile data)</span></label>
    ${!c.enabled && !live && !mode && html`
      <p class="small dim" style="margin:0 0 10px">Start videos from your phone, watch them being made, edit on either device and download them anywhere. Your PC does the heavy work. Uses your own free Supabase project, so your data stays in your account.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn primary" onClick=${() => setMode("setup")}>Set up sync (first device)</button>
        <button class="btn" onClick=${() => setMode("pair")}>I set it up on another device</button>
      </div>`}

    ${mode === "pair" && !live && html`
      <p class="small dim" style="margin:0 0 8px">Scan the QR code shown on your other device, or paste its pairing code.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn primary" onClick=${() => setScan(true)}>📷 Scan code</button>
        <input class="input" style="flex:1;min-width:200px" placeholder="…or paste the pairing code (cfpair:…)" value=${code} onInput=${(e) => setCode(e.target.value)} />
        <button class="btn" disabled=${busy || !code.trim()} onClick=${() => usePair(code)}>Use code</button>
      </div>
      <button class="btn small" style="margin-top:8px" onClick=${() => setMode("")}>← Back</button>`}

    ${mode === "setup" && !live && html`<ol class="small steps">
      <li><b>Make a free Supabase project.</b> <button class="btn small" onClick=${() => openSite("https://supabase.com/dashboard/new")}>Open Supabase ↗</button><br /><span class="dim">Sign up (free), press New project, pick any name and password, wait about a minute.</span></li>
      <li><b>Set up the database.</b> Copy this, then in Supabase open <b>SQL Editor → New query</b>, paste, and press <b>Run</b>.
        <div class="row" style="gap:8px;margin-top:6px"><button class="btn small primary" onClick=${() => copy(SYNC_SQL, "Setup SQL copied 📋")}>📋 Copy setup SQL</button><button class="btn small" onClick=${() => setShowSql(!showSql)}>${showSql ? "Hide" : "Show"} it</button></div>
        ${showSql && html`<pre class="tech" style="max-height:200px;overflow:auto;white-space:pre-wrap">${SYNC_SQL}</pre>`}</li>
      <li><b>Paste your project's address and key.</b> In Supabase: <b>Project Settings → API</b> (or the Connect button). Copy the <b>Project URL</b> and the <b>anon / publishable</b> key (not the secret one).
        <div style="display:grid;gap:6px;margin-top:6px">
          <input class="input" placeholder="https://xxxxxxxx.supabase.co" value=${url} onInput=${(e) => setUrl(e.target.value)} onPaste=${(e) => { const p = Sync.readPair(e.clipboardData?.getData("text")); if (p?.anon) { e.preventDefault(); setUrl(p.url || url); setAnon(p.anon); } }} />
          <input class="input" placeholder="anon public key (eyJ… or sb_publishable_…)" value=${anon} onInput=${(e) => setAnon(e.target.value)} />
          <button class="btn primary" disabled=${busy || !url || !anon} onClick=${() => run(async () => (await Sync.setup({ url, anon }), setMode("account")))}>${busy ? "Connecting…" : "Connect"}</button>
        </div></li>
    </ol><button class="btn small" onClick=${() => setMode("")}>← Back</button>`}

    ${(mode === "account" || (c.enabled && !st.user)) && !live && c.url && html`
      <p class="small" style="margin:0 0 8px">Connected to your project. Now sign in. <b>Use the same email and password on every device.</b></p>
      <div style="display:grid;gap:6px;max-width:420px">
        <input class="input" type="email" autocomplete="email" placeholder="Email" value=${email} onInput=${(e) => setEmail(e.target.value)} />
        <input class="input" type="password" autocomplete="current-password" placeholder="Password (6+ characters)" value=${pw} onInput=${(e) => setPw(e.target.value)} />
        <div class="row" style="gap:8px">
          <button class="btn primary" disabled=${busy || !email || pw.length < 6} onClick=${() => run(async () => { const r = await Sync.signIn(email, pw, false); if (r.ok) toast("Synced ✓"); })}>Sign in</button>
          <button class="btn" disabled=${busy || !email || pw.length < 6} onClick=${() => run(async () => { const r = await Sync.signIn(email, pw, true); if (r.needsConfirm) setMsg("📧 Account made. Open the confirmation email from Supabase, tap the link, then come back and press Sign in."); else toast("Synced ✓"); })}>Make account</button>
        </div>
      </div>
      <button class="btn small" style="margin-top:8px" onClick=${() => Sync.signOut().then(() => setMode(""))}>Use a different project</button>`}

    ${live && html`
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:240px">
          <div><${SyncPill} /> <span class="small dim">${st.user.email}${st.lastSync ? " · last synced " + new Date(st.lastSync).toLocaleTimeString() : ""}</span></div>
          ${st.error && html`<p class="small" style="color:#ffe0a0;margin:6px 0 0">⚠️ ${st.error}</p>`}
          <div class="small dim" style="margin:10px 0 4px">Your devices</div>
          <div style="display:grid;gap:4px">${devices.map(([id, d]) => html`<div class="row small" style="gap:8px">
            <span>${d.phone ? "📱" : "💻"}</span><b>${d.name}${id === Sync.me.id ? " (this one)" : ""}</b>
            <span class="dim">${id === Sync.me.id ? "online now" : seenAgo(d.lastSeen)}${d.worker ? " · makes videos" : " · watches & edits"}${d.running ? ` · making ${d.running}` : ""}</span></div>`)}</div>
          <div style="display:grid;gap:6px;margin-top:12px">
            <label class="small row" style="gap:8px;cursor:pointer"><input type="checkbox" checked=${c.worker} onChange=${(e) => Sync.setOptions({ worker: e.target.checked })} /> This device makes videos ${isPhone() ? html`<span class="dim">(uses battery; usually leave it to the PC)</span>` : ""}</label>
            <label class="small row" style="gap:8px;cursor:pointer"><input type="checkbox" checked=${c.videos} onChange=${(e) => Sync.setOptions({ videos: e.target.checked })} /> Sync finished videos <span class="dim">(so you can watch and download them on every device)</span></label>
            <label class="small row" style="gap:8px;cursor:pointer"><input type="checkbox" checked=${c.syncKeys} onChange=${(e) => Sync.setOptions({ syncKeys: e.target.checked })} /> Also sync my API keys <span class="dim">(only needed if a phone makes videos; stored in your private database)</span></label>
            <label class="small row" style="gap:8px">Name of this device <input class="input" style="width:150px;padding:4px 8px" value=${Sync.me.name} onChange=${(e) => { Sync.me.name = e.target.value.trim().slice(0, 30) || Sync.me.name; saveSettingRaw("cf-device", Sync.me); Sync.connect(); }} /></label>
          </div>
        </div>
        <div style="text-align:center">
          <${QrCode} text=${Sync.pairCode()} size=${170} />
          <div class="small dim" style="max-width:190px;margin:6px auto">Add another device: scan this with it (Connect AI → Sync → I set it up on another device)</div>
          <button class="btn small" onClick=${() => copy(Sync.pairCode(), "Pairing code copied 📋")}>📋 Copy pairing code</button>
        </div>
      </div>
      <button class="btn small" style="margin-top:12px" onClick=${async () => { if (await confirmBox({ title: "Stop syncing this device?", body: "Everything stays on this device and in your Supabase project. You can sign in again any time.", yes: "Stop syncing" })) Sync.signOut().then(() => setMode("")); }}>Stop syncing this device</button>`}
    ${msg && html`<p class="small" style="margin:10px 0 0">${msg}</p>`}
    ${scan && html`<${Scanner} onCode=${usePair} onClose=${() => setScan(false)} />`}
  </div>`;
}

/** Project page: a phone with work waiting and no PC online. */
function WaitingForWorker({ videos, project }) {
  const st = useSync();
  if (!Sync.on() || Sync.isWorker()) return null;
  const waiting = videos.filter((v) => v.status === "queued" || (v.status === "working" && staleWorkerOf(v))).length || (project?.status === "planning" && !project.deletedAt ? 1 : 0);
  if (!waiting) return null;
  const online = Sync.workersOnline();
  return html`<div class="banner warn" style="margin:10px 0"><span class="small">
    ${online.length
      ? html`💻 <b>${online.map(([, d]) => d.name).join(", ")}</b> is making these. You can watch, edit and download here.`
      : html`⏳ <b>${waiting} video${waiting > 1 ? "s" : ""} waiting for your PC.</b> Open Content Factory on your PC and they start by themselves.`}</span>
    ${!online.length && html`<button class="btn small" style="margin-left:8px" onClick=${() => Sync.setOptions({ worker: true })}>Make them on this phone</button>`}
  </div>`;
}
const staleWorkerOf = (v) => !v.worker || Date.now() - Date.parse(v.worker.at || 0) > 75000;
