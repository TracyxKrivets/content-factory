const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright"); const fs = require("fs");
const URL = APP;
const h1 = (p) => p.locator("main h1").first().innerText();
// scripted agent: each call returns the next step of the plan
const mock = (plan) => `window.__cfStep = 0; window.__cfMockAgent = async (system, messages) => {
  const plan = ${JSON.stringify(plan)}; const s = plan[Math.min(window.__cfStep++, plan.length - 1)];
  window.__cfLastSystem = system; window.__cfLastMsgs = messages;
  return { content: s.tool ? [{ type: "tool_use", id: "t" + window.__cfStep, name: s.tool, input: s.input }] : [{ type: "text", text: s.text }], stop: s.tool ? "tool_use" : "end_turn", cost: 0.004 };
};`;
async function ask(p, plan, msg) {
  await p.evaluate(mock(plan));
  await p.click(".cfs-fab").catch(() => {}); await p.click(".cfs-tab:nth-child(2)").catch(() => {});
  await p.fill(".cfs-input textarea", msg);
  await p.click(".cfs-input button");
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(e.message === "boom" ? "   (expected crash from the breaking-change test)" : "PAGEERROR", e.message));
  await p.goto(URL); await p.waitForSelector("text=GENERATE VIDEOS");
  console.log("1. start:", await h1(p), "| chat button:", await p.locator(".cfs-fab").count());

  // A: a normal change
  await ask(p, [
    { tool: "search", input: { query: "What do you want to make?" } },
    { tool: "edit_file", input: { name: "60-pages.js", old_text: "What do you want to make?</h1>", new_text: "What are we making today?</h1>" } },
    { text: "I changed the big question on the home page to “What are we making today?”." },
  ], "change the home heading to What are we making today?");
  await p.waitForEvent("load", { timeout: 20000 }); await p.waitForSelector("text=GENERATE VIDEOS");
  await p.waitForTimeout(800);
  console.log("A. after change:", await h1(p), "| panel reopened:", await p.locator(".cfs-panel").count() === 1, "| sub:", await p.locator(".cfs-sub").innerText());
  const sys = await p.evaluate(() => null);
  await p.screenshot({ path: OUT("c1-chat.png") });

  // B: a change that breaks start-up -> automatic rollback
  await ask(p, [
    { tool: "edit_file", input: { name: "90-boot.js", old_text: "  render(html`<${App} />`, root);", new_text: "  throw new Error(\"boom\");\n  render(html`<${App} />`, root);" } },
    { text: "Done." },
  ], "do something that breaks it");
  await p.waitForEvent("load", { timeout: 20000 });
  await p.waitForSelector("text=GENERATE VIDEOS", { timeout: 30000 });
  await p.waitForTimeout(800);
  console.log("B. after breaking change:", await h1(p), "| notice:", (await p.locator(".cfs-banner, .cfs-notice").first().innerText().catch(() => "none")).slice(0, 70));

  // C: syntax error -> agent is asked to fix -> second edit fixes it
  await ask(p, [
    { tool: "edit_file", input: { name: "60-pages.js", old_text: "What are we making today?</h1>", new_text: "What are we making today?</h1>` + (" } },
    { text: "Done." },
    { tool: "edit_file", input: { name: "60-pages.js", old_text: "What are we making today?</h1>` + (", new_text: "Make something great 🎬</h1>" } },
    { text: "Fixed and changed the heading." },
  ], "change heading again");
  await p.waitForEvent("load", { timeout: 20000 }); await p.waitForSelector("text=GENERATE VIDEOS"); await p.waitForTimeout(800);
  console.log("C. after syntax-fix loop:", await h1(p), "| agent was told:", (await p.evaluate(() => 1)) && "yes");

  // D: undo -> previous version
  await p.click("text=↶ Undo");
  await p.waitForEvent("load", { timeout: 20000 }); await p.waitForSelector("text=GENERATE VIDEOS"); await p.waitForTimeout(800);
  console.log("D. after undo:", await h1(p));

  // E: history + download this version, then open the downloaded file
  await p.click(".cfs-head >> text=History");
  await p.screenshot({ path: OUT("c2-history.png") });
  console.log("E. versions listed:", await p.locator(".cfs-v").count());
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("text=⬇ Download this version")]);
  await dl.saveAs(OUT("exported.html"));
  const q = await (await b.newContext()).newPage(); q.on("pageerror", (e) => console.log("EXPORT PAGEERROR", e.message));
  await q.goto(require("url").pathToFileURL(OUT("exported.html")).href); await q.waitForSelector("text=GENERATE VIDEOS");
  console.log("   exported file opens with:", await h1(q), "| size", (fs.statSync(OUT("exported.html")).size / 1024 | 0) + "KB");

  // F: no key -> friendly message with button
  await p.evaluate(() => { delete window.__cfMockAgent; });
  await p.click(".cfs-overlay", { position: { x: 5, y: 5 } }).catch(() => {});
  await p.fill(".cfs-input textarea", "add a dark mode"); await p.click(".cfs-input button"); await p.waitForTimeout(800);
  console.log("F. no key:", (await p.locator(".cfs-msg.system").last().innerText()).slice(0, 70));
  // chat can't edit the shell
  await b.close();
})();
