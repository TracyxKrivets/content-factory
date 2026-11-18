const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const a = await b.newPage();
  await a.goto(APP); await a.waitForSelector("text=GENERATE VIDEOS");
  await a.setInputFiles(".dropzone input[type=file]", [FIX("one.mp4")]);
  let r;
  for (let i = 0; i < 120; i++) { r = await a.evaluate(async () => (await window.__cf.kv.get("ref-files"))?.[0]); if (r && (r.status === "done" || r.status === "error")) break; await a.waitForTimeout(500); }
  console.log("app-made video (scene changes + slow pans):", r.status, JSON.stringify(r.meta || r.error), "|", r.notes?.summary);
  await b.close();
})();
