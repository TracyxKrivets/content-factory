const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
// Practice mode (no AI) with TikTok + YouTube + Bilibili picked.
const { chromium } = require("playwright");
const URL = APP;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(URL); await p.waitForSelector("text=GENERATE VIDEOS"); await p.waitForTimeout(500);
  await p.fill("textarea >> nth=0", "Make 2 fast facts about the ocean");
  await p.click("button.chip:text-is('1')");
  await p.click("button.chip:has-text('30 sec')");
  for (const n of ["TikTok", "YouTube Shorts", "Bilibili"]) await p.click(`button.chip:has-text('${n}')`);
  for (const t of await p.$$eval(".card p.small", (els) => els.map((e) => e.textContent.trim()).filter((t) => /per platform|only pay|One video/.test(t)))) console.log("UI:", t);
  console.log("summary:", await p.textContent("p.dim.small >> text=per platform"));
  await p.click("text=GENERATE VIDEOS");
  for (let i = 0; i < 300; i++) {
    await p.waitForTimeout(1000);
    const st = await p.evaluate(async () => (await window.__cf.db.all("videos")).map((v) => v.status));
    if (i % 20 === 0) console.log(i + "s", st.join(","));
    if (st.length === 3 && st.every((x) => x === "done" || x === "needs_attention") && st.length === 3) break;
  }
  const vs = await p.evaluate(async () => window.__cf.db.all("videos"));
  for (const v of vs) {
    const bad = Object.entries(v.steps).filter(([, s]) => s.error).map(([k, s]) => k + ": " + s.error.technical?.slice(0, 160));
    console.log(v.platform, v.status, "|", v.title.slice(0, 30), "| secs", v.steps.final_check.output?.seconds?.toFixed(1),
      "| report", JSON.stringify(Object.fromEntries(Object.entries(v.steps.final_check.output?.platforms || {}).map(([k, r]) => [k, r.ok]))),
      "| posts", Object.keys(v.steps.script.output?.posts || {}).join(","), bad.length ? "| ERR " + bad.join("; ") : "");
  }
  await p.screenshot({ path: OUT("p4-practice.png"), fullPage: true });
  await b.close();
})();
