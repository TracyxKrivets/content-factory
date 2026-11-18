const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
const URL = APP;
// stand-in for claude.ai's window.claude (sample + downloads)
const MOCK = () => {
  window.__calls = []; window.__saves = [];
  const sample = async (input, opts = {}) => {
    const text = typeof input === "string" ? input : input.map((t) => t.content).join("\n");
    window.__calls.push({ model: opts.model, tier: opts.modelTier, tools: !!opts.tools, kind: /Design a style/.test(text) ? "style" : /video ideas/.test(text) ? "ideas" : /Score 1-10/.test(text) ? "check" : /image prompt/.test(text) ? "scenes" : opts.tools ? "chat" : "script" });
    await new Promise((r) => setTimeout(r, 50));
    if (opts.tools) {
      const t = Object.fromEntries(opts.tools.map((x) => [x.name, x]));
      await t.search.execute({ query: "What do you want to make?" });
      await t.edit_file.execute({ name: "60-pages.js", old_text: "What do you want to make?</h1>", new_text: "Let's make something 🔥</h1>" });
      return { text: "I changed the big question on the home page.", truncated: false };
    }
    if (/Design a style/.test(text)) return { text: JSON.stringify({ name: "Gym Motivation", emoji: "💪", description: "Hard-hitting gym pep talks", hookStyle: "Call them out", structure: "Hard truth, reframe, push", visualStyle: "Dark gym, chalk, sweat, dramatic light", voiceStyle: "intense coach", captionStyle: "red-highlight", musicStyle: "tense-pulse", lengthSec: 25 }) };
    if (/video ideas/.test(text)) return { text: JSON.stringify({ ideas: [{ title: "No Excuses Monday", angle: "skipping leg day" }, { title: "5AM Club", angle: "early workouts" }] }) };
    if (/Score 1-10/.test(text)) return { text: JSON.stringify({ hook: 8, pacing: 8, escalation: 8, ending: 8, issues: [], pass: true }) };
    if (/image prompt/.test(text)) { const n = (text.match(/^\d+\. /gm) || []).length; return { text: JSON.stringify({ scenes: Array.from({ length: n }, (_, i) => ({ visual: "dark gym scene " + i, search: "gym" })) }) }; }
    return { text: JSON.stringify({ title: "Get Up", lines: ["Nobody is coming to drag you out of bed.", "The alarm rings and you have a choice.", "Every rep you skip is a promise you broke.", "Your future self is watching.", "So get up and go."], caption: "Get up.", hashtags: ["#gym"] }) };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
  const downloads = { save: async ({ filename, data }) => { window.__saves.push({ filename, size: data.size || data.length }); return { status: "saved" }; } };
  window.claude = { use: async (n) => (n === "sample" ? sample : n === "downloads" ? downloads : null) };
};
(async () => {
  const b = await chromium.launch();
  // ---- 1. file mode, no keys, typed content type
  const p0 = await b.newPage(); p0.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p0.goto(URL); await p0.waitForSelector("text=GENERATE VIDEOS");
  console.log("1. nav:", (await p0.locator("nav").innerText()).replace(/\s+/g, " "));
  await p0.fill("textarea.big", "Make 1 short about waking up early");
  await p0.fill("input[placeholder*='scary stories']", "gym motivation");
  await p0.click("text=GENERATE VIDEOS");
  await p0.waitForSelector("text=All done", { timeout: 200000 });
  console.log("   file mode style:", await p0.locator(".badge").first().innerText());

  // ---- 2. inside "Claude"
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(URL); await p.waitForSelector("text=GENERATE VIDEOS"); await p.waitForTimeout(500);
  console.log("2. practice banner inside Claude:", await p.locator("text=Practice mode").count());
  await p.click("nav .link:has-text('Connect AI')"); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT("r1-connect-claude.png"), fullPage: true });
  const writerCard = p.locator(".card").filter({ hasText: "Writes the ideas" });
  console.log("   writer selected:", await writerCard.locator(".roleopt.on b").innerText(), "| writer options shown:", (await writerCard.locator(".roleopt b").allInnerTexts()).join(", "));
  await writerCard.locator("button.chip:has-text('Opus 5.5')").click();
  await p.click("text=DONE: MAKE VIDEOS");
  await p.fill("textarea.big", "Make 2 shorts about waking up early");
  await p.fill("input[placeholder*='scary stories']", "gym motivation");
  await p.click("text=GENERATE VIDEOS");
  await p.waitForSelector("text=All done", { timeout: 200000 });
  console.log("   style:", await p.locator(".badge").first().innerText(), "| practice badge on cards (want 0):", await p.locator("text=Practice quality").count());
  const calls = await p.evaluate(() => window.__calls);
  console.log("   Claude calls:", calls.map((c) => `${c.kind}:${c.model}`).join(" "));
  await p.click("text=DOWNLOAD ALL"); await p.waitForTimeout(1500);
  console.log("   saved through Claude:", JSON.stringify(await p.evaluate(() => window.__saves)));
  // chat on Claude account
  await p.click(".cfs-fab"); await p.fill(".cfs-input textarea", "change the heading"); await p.click(".cfs-input button");
  await p.waitForEvent("load", { timeout: 30000 }); await p.waitForTimeout(1200);
  await p.click("nav .link:has-text('Make')"); await p.waitForTimeout(400);
  console.log("   chat edit via Claude account:", await p.locator("main h1").first().innerText(), "| chat model:", (await p.evaluate(() => window.__calls)).filter((c) => c.kind === "chat").map((c) => c.model).join(","));

  // ---- 3. file mode, role page with a key
  const q = await b.newPage(); q.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await q.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }) }));
  await q.goto(URL + "#connect"); await q.waitForSelector("text=Connect AI");
  console.log("3. no keys -> role cards shown:", await q.locator(".card .roleopt").count(), "| empty note:", await q.isVisible("text=No APIs added yet"));
  const ecard = q.locator(".card").filter({ hasText: "Writes the ideas" });
  await q.fill("textarea[placeholder*='paste here']", "sk-ant-api03-" + "x".repeat(60));
  await q.click("button:has-text('Add key')"); await q.waitForTimeout(800);
  console.log("   writer after saving key:", await ecard.locator(".roleopt.on b").innerText(), "| chat card picks:", await q.locator(".card").filter({ hasText: "Fixes, adds" }).locator(".roleopt.on b").innerText());
  console.log("   only Anthropic shown:", (await q.locator(".card .roleopt b").allInnerTexts()).join(", "), "| voice card shown (want false):", await q.locator(".card").filter({ hasText: "Reads the script" }).count() > 0);
  await q.screenshot({ path: OUT("r2-connect-file.png"), fullPage: true });
  await b.close();
})();
