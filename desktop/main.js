// Content Factory desktop: opens the single-file app in its own window.
// - Keys, projects and videos are saved in %APPDATA%\Content Factory, so they're there next time.
// - Every web request goes through Windows' own network stack (system proxy, VPN, company
//   certificates), so the app works on whatever internet this computer is using.
// - Websites (billing, plans, "get a key") open in windows inside the app, with logins remembered.
const { app, BrowserWindow, shell, session, Menu, ipcMain, net } = require("electron");
const path = require("path");

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
  win.loadFile(path.join(__dirname, "app", "index.html"));
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
});
app.on("window-all-closed", () => app.quit());
