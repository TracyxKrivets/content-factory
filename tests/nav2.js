const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright"); const fs = require("fs");
const FILE = path.join(__dirname, "../web/dist/content-factory.html");
const URL = "file://" + FILE;
const NAV = ["📁 Projects", "🔌 Connect AI", "⚙ System", "✚ Make"];
async function walk(frame, label) {
  const out = [];
  for (const n of NAV) {
    await frame.click(`nav .link:has-text("${n}")`);
    await frame.waitForTimeout(500);
    out.push((await frame.locator("main h1").first().innerText().catch(() => "NONE")).slice(0, 14));
  }
  console.log(label.padEnd(34), out.join(" | "));
}
(async () => {
  const b = await chromium.launch();
  // 1. normal
  const p = await b.newPage(); p.on("pageerror", (e) => console.log("ERR", e.message));
  await p.goto(URL); await p.waitForSelector("text=GENERATE VIDEOS"); await walk(p, "normal Chrome");
  // 2. locked-down preview: scripts only, storage blocked
  fs.writeFileSync(OUT("sandbox.html"), `<iframe sandbox="allow-scripts" src="${URL}" style="width:1200px;height:900px"></iframe>`);
  const q = await b.newPage(); q.on("pageerror", (e) => console.log("IFRAME ERR", e.message));
  await q.goto(require("url").pathToFileURL(OUT("sandbox.html")).href); await q.waitForTimeout(2500);
  const f = q.frames()[1];
  console.log("storage warning shown:", await f.locator("text=Nothing will be saved here").count() > 0);
  await walk(f, "sandboxed preview (no storage)");
  await f.click(`nav .link:has-text("✚ Make")`);
  await f.fill("textarea.big", "One motivation short about waking up early");
  await f.click("text=GENERATE VIDEOS");
  await f.waitForSelector("text=All done", { timeout: 200000 });
  console.log("generated a video inside the locked preview ✓");
  // 3. page where another script hijacks link clicks (like some viewers)
  const html = fs.readFileSync(FILE, "utf8").replace("<body>", `<body><script>document.addEventListener("click",e=>{if(e.target.closest("a")){e.preventDefault();window.__hijacked=(window.__hijacked||0)+1}});</script>`);
  fs.writeFileSync(OUT("hijack.html"), html);
  const r = await b.newPage(); await r.goto(require("url").pathToFileURL(OUT("hijack.html")).href); await r.waitForSelector("text=GENERATE VIDEOS");
  await walk(r, "link-hijacking viewer");
  await r.fill("textarea.big", "x"); await r.goto(require("url").pathToFileURL(OUT("hijack.html")).href + "#projects"); await r.waitForTimeout(800);
  await b.close();
})();
