// Content Factory desktop: opens the single-file app in its own window.
// - Keys, projects and videos are saved in %APPDATA%\Content Factory, so they're there next time.
// - Every web request goes through Windows' own network stack (system proxy, VPN, company
//   certificates), so the app works on whatever internet this computer is using.
// - Websites (billing, plans, "get a key") open in windows inside the app, with logins remembered.
const { app, BrowserWindow, shell, session, Menu, ipcMain, net } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const PKG = require("./package.json");

if (!app.requestSingleInstanceLock()) app.quit();

let win;
const pending = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 420,
    minHeight: 600,
    title: "Content Factory",
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: true, // must stay on: turning it off also turns off the video encoder
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep making videos when the window is minimised
    },
  });
  loadApp();
  // links and pop-ups (billing pages, "Get a key") open in an in-app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) openSiteWindow(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:/i.test(url)) {
      e.preventDefault();
      openSiteWindow(url);
    }
  });
}

// ---- automatic updates: fixes published from Claude arrive here without reinstalling
// The app is one HTML file. Updates are saved in %APPDATA%\Content Factory\app-update and used
// when they're newer than the copy inside the .exe. A broken update is undone automatically.
const BUNDLED = path.join(__dirname, "app", "index.html");
const updDir = () => path.join(app.getPath("userData"), "app-update");
const updFile = () => path.join(updDir(), "index.html");
const prevFile = () => path.join(updDir(), "previous.html");
const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
const state = () => readJson(path.join(updDir(), "state.json"), { bad: [] });
const saveState = (s) => {
  fs.mkdirSync(updDir(), { recursive: true });
  fs.writeFileSync(path.join(updDir(), "state.json"), JSON.stringify(s, null, 1));
};
const versionOfText = (t) => (String(t).match(/"builtAt":"([^"]+)"/) || [])[1] || "";
const versionOf = (f) => {
  try {
    return versionOfText(fs.readFileSync(f, "utf8"));
  } catch {
    return "";
  }
};
// where to look for updates: set in the app, baked into the .exe, or carried inside the running app file
const sourceInFile = (f) => {
  try {
    return (fs.readFileSync(f, "utf8").match(/"updateUrl":"(https:\/\/[^"]+)"/) || [])[1] || "";
  } catch {
    return "";
  }
};
const updateSource = () => state().source || PKG.cfUpdate?.url || sourceInFile(current?.file || BUNDLED) || sourceInFile(BUNDLED);
/** The newest copy of the app that isn't known to be broken. */
function bestApp() {
  const bad = state().bad || [];
  const options = [{ file: BUNDLED, version: versionOf(BUNDLED), updated: false }];
  for (const f of [updFile(), prevFile()]) if (fs.existsSync(f)) options.push({ file: f, version: versionOf(f), updated: true });
  return options.filter((o) => o.version && !bad.includes(o.version)).sort((a, b) => (a.version < b.version ? 1 : -1))[0] || options[0];
}
let current = null, bootTimer = null, pendingUpdate = null;
function loadApp() {
  current = bestApp();
  clearTimeout(bootTimer);
  if (current.updated) {
    // if the update doesn't start within 30 s, mark it broken and go back to the last good copy
    bootTimer = setTimeout(() => {
      const s = state();
      s.bad = [...new Set([...(s.bad || []), current.version])];
      saveState(s);
      loadApp();
    }, 30000);
  }
  win.loadFile(current.file);
}
ipcMain.on("cf-booted", (e) => {
  if (win && e.sender === win.webContents) clearTimeout(bootTimer);
});
/** Check the update address; download, verify and install a newer version. */
async function checkForUpdate() {
  const src = updateSource();
  if (!src) return { status: "off" };
  try {
    const res = await net.fetch(src + (src.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return { status: "error", message: `The update address answered ${res.status}` };
    const m = await res.json();
    const have = [bestApp().version, fs.existsSync(updFile()) ? versionOf(updFile()) : ""].sort().pop();
    if (!m.version || m.version <= have || state().bad.includes(m.version)) return { status: "latest", version: bestApp().version };
    const r2 = await net.fetch(new URL(m.file || "app.html", src).href + "?v=" + encodeURIComponent(m.version), { cache: "no-store" });
    if (!r2.ok) return { status: "error", message: `Couldn't download the update (${r2.status})` };
    const text = await r2.text();
    return installHtml(text, m);
  } catch (err) {
    return { status: "error", message: String((err && err.message) || err) };
  }
}
function installHtml(text, m = {}) {
  const v = versionOfText(text);
  if (!/id="cf-source"/.test(text) || !v) return { status: "error", message: "That isn't a Content Factory app file" };
  if (m.sha256 && crypto.createHash("sha256").update(text).digest("hex") !== m.sha256) return { status: "error", message: "The download was damaged; it will try again later" };
  if (m.version && v !== m.version) return { status: "error", message: "The update didn't match its description" };
  if (v <= bestApp().version) return { status: "latest", version: bestApp().version };
  fs.mkdirSync(updDir(), { recursive: true });
  // keep the update that's working now as a fallback, in case the new one won't start
  if (fs.existsSync(updFile()) && current?.file === updFile()) fs.copyFileSync(updFile(), prevFile());
  fs.writeFileSync(updFile() + ".tmp", text);
  fs.renameSync(updFile() + ".tmp", updFile());
  const s = state();
  s.bad = (s.bad || []).filter((x) => x !== v);
  s.notes = m.notes || "";
  saveState(s);
  pendingUpdate = { version: v, notes: m.notes || "" };
  win?.webContents.send("cf-update-ready", pendingUpdate);
  return { status: "installed", ...pendingUpdate };
}
ipcMain.handle("cf-update-check", (e) => (win && e.sender === win.webContents ? checkForUpdate() : { status: "error" }));
ipcMain.handle("cf-update-install-file", (e, text) => (win && e.sender === win.webContents ? installHtml(String(text || "")) : { status: "error" }));
ipcMain.handle("cf-update-info", () => ({ version: current?.version, updated: !!current?.updated, source: updateSource(), pending: pendingUpdate, appVersion: app.getVersion() }));
ipcMain.handle("cf-update-source", (e, url) => {
  if (!win || e.sender !== win.webContents) return false;
  const s = state();
  s.source = /^https:\/\//i.test(url || "") ? url : "";
  saveState(s);
  return true;
});
ipcMain.on("cf-restart", (e) => {
  if (win && e.sender === win.webContents) {
    pendingUpdate = null;
    loadApp();
  }
});

// ---- websites inside the app (separate, persistent login storage; no access to the app's bridge)
const plainUA = (ua) => ua.replace(/\s(Electron|content-factory|Content Factory)\/\S+/gi, "");
function openSiteWindow(url) {
  const w = new BrowserWindow({
    width: 1100, height: 860, title: "Loading…", backgroundColor: "#ffffff",
    webPreferences: { partition: "persist:accounts", contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // a normal Chrome user agent, so sign-in pages (Google, Stripe checkout) treat it like a browser
  w.webContents.setUserAgent(plainUA(w.webContents.getUserAgent()));
  const nav = w.webContents.navigationHistory || w.webContents;
  w.setMenu(
    Menu.buildFromTemplate([
      { label: "← Back", click: () => (nav.canGoBack() ? nav.goBack() : null) },
      { label: "↻ Reload", click: () => w.webContents.reload() },
      { label: "Open in my browser", click: () => shell.openExternal(w.webContents.getURL()) },
      { label: "✕ Close", click: () => w.close() },
    ]),
  );
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!/^https?:/i.test(u)) return { action: "deny" };
    // payment pop-ups (3-D Secure, PayPal) and sign-in pop-ups stay in the same login storage
    return { action: "allow", overrideBrowserWindowOptions: { width: 600, height: 760, webPreferences: { partition: "persist:accounts", sandbox: true, contextIsolation: true } } };
  });
  w.loadURL(url);
  return w;
}

// ---- network bridge: the app's requests, made by the operating system's network stack
ipcMain.handle("cf-net", async (e, r) => {
  if (!win || e.sender !== win.webContents) return { error: "not allowed" };
  if (!r || !/^https:\/\//i.test(r.url)) return { error: "only https is allowed" };
  const ac = new AbortController();
  pending.set(r.id, ac);
  const cap = setTimeout(() => ac.abort(), 10 * 60000); // safety: nothing may hang forever
  try {
    const res = await net.fetch(r.url, {
      method: r.method || "GET",
      headers: r.headers || [],
      body: r.body ? Buffer.from(r.body) : undefined,
      signal: ac.signal,
      redirect: "follow",
    });
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, statusText: res.statusText, headers: [...res.headers], body };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  } finally {
    clearTimeout(cap);
    pending.delete(r.id);
  }
});
ipcMain.on("cf-net-abort", (_e, id) => pending.get(id)?.abort());
ipcMain.handle("cf-net-info", async () => ({
  online: net.isOnline(),
  proxy: await session.defaultSession.resolveProxy("https://api.openai.com").catch(() => "DIRECT"),
}));

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  // safety net for anything not going through the bridge (e.g. images): allow the app to read answers
  session.defaultSession.webRequest.onHeadersReceived((details, done) => {
    const h = details.responseHeaders || {};
    const has = Object.keys(h).some((k) => k.toLowerCase() === "access-control-allow-origin");
    if (!has && /^https:/i.test(details.url)) {
      h["Access-Control-Allow-Origin"] = ["*"];
      h["Access-Control-Allow-Headers"] = ["*"];
      h["Access-Control-Allow-Methods"] = ["GET, POST, OPTIONS"];
    }
    done({ responseHeaders: h });
  });
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    ]),
  );
  createWindow();
  // look for updates shortly after starting, then every 30 minutes
  setTimeout(checkForUpdate, 8000);
  setInterval(checkForUpdate, 30 * 60000);
});
app.on("window-all-closed", () => app.quit());
