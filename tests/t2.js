const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
const URL = APP;
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 }, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(URL + "#connect");
  await p.waitForSelector("text=Paste any API key");
  await p.fill("textarea[placeholder*='paste here']", "sk-ant-api03-" + "x".repeat(80));
  await p.click("button:has-text('Add key')");
  await p.waitForSelector("text=/rejected/", { timeout: 20000 });
  console.log("key test:", (await p.locator("text=/rejected/").first().innerText()).slice(0, 90));
  // the paste box won't keep a rejected key; save it directly to test the error + backup path below
  await p.evaluate(() => { localStorage.setItem("cf-keys", JSON.stringify({ ANTHROPIC_API_KEY: "sk-ant-api03-" + "x".repeat(80) })); });
  await p.screenshot({ path: OUT("4-connect.png") });
  // generate -> writer fails with real 401
  await p.goto(URL + "#make");
  await p.fill("textarea.big", "One storytime short about missing the last train");
  await p.click("text=GENERATE VIDEOS");
  await p.waitForSelector("text=TRY AGAIN", { timeout: 60000 });
  console.log("error shown:", await p.locator(".banner.bad b").first().innerText());
  await p.screenshot({ path: OUT("5-error.png"), fullPage: true });
  await p.click("text=USE BACKUP");
  // reload while it's working → must resume
  await p.waitForFunction(() => /Editing|Planning scenes|Making visuals|Timing/.test(document.body.innerText), null, { timeout: 60000 });
  const before = await p.evaluate(() => document.querySelector(".vframe .small")?.innerText);
  console.log("reloading during:", before);
  p.on("dialog", (d) => d.accept());
  await p.reload();
  await p.waitForSelector("text=All done", { timeout: 200000 });
  console.log("resumed and finished after reload ✓");
  const prov = await p.evaluate(async () => {
    const v = (await window.__cf.db.all("videos"))[0];
    return Object.entries(v.steps).map(([k, s]) => k + ":" + (s.provider || "") + ":" + s.status).join(" ");
  });
  console.log(prov);
  // edit script with same line count -> visuals kept, rebuild
  const before2 = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0].steps.visuals.output.images[0]);
  await p.click("text=✏️ Edit");
  const ta = p.locator(".modal textarea");
  const txt = await ta.inputValue();
  await ta.fill(txt.replace(/^[^\n]+/, "EDITED: I missed the last train and the station lights went out."));
  await p.click("text=SAVE & REBUILD");
  await p.waitForTimeout(1500);
  await p.waitForSelector("text=All done", { timeout: 200000 });
  const after = await p.evaluate(async () => { const v = (await window.__cf.db.all("videos"))[0]; return [v.steps.visuals.output.images[0], v.steps.script.output.lines[0], v.steps.script.provider]; });
  console.log("edit kept visuals:", after[0] === before2, "| line1:", after[1].slice(0, 40), "| by:", after[2]);
  await b.close();
})();
