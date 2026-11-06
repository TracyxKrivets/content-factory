// Content Factory desktop: opens the single-file app in its own window.
// Keys, projects and videos are saved in the app's own storage (%APPDATA%\Content Factory on Windows),
// so they're still there next time you open it.
const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) app.quit();

let win;
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
      webSecurity: true, // must stay on: turning it off also turns off the video encoder
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep making videos when the window is minimised
    },
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));

  // "Get a key ↗" and other links open in your normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  // Some services (stock-photo files, link previews) don't allow calls from a web page.
  // This app is a trusted local file, so let it read those answers.
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
  // Save downloads straight away with a "Save as" box, starting in Downloads
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  });
  // tiny menu: reload + developer tools for troubleshooting (hidden until Alt is pressed)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    ]),
  );
  createWindow();
});
app.on("window-all-closed", () => app.quit());
