const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
const K = { xai: "xai-" + "A1b2".repeat(10), ds: "sk-" + "0123456789abcdef".repeat(2), rep: "r8_" + "Z".repeat(37), weird: "qq" + "W".repeat(38) };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  const J = (r, body, status = 200) => r.fulfill({ status, headers: H, contentType: "application/json", body: JSON.stringify(body) });
  const chats = [];
  await ctx.route("https://api.x.ai/**", async (r) => {
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: H });
    if (r.request().headers()["authorization"] !== "Bearer " + K.xai) return J(r, { error: "bad key" }, 401);
    if (/\/models/.test(r.request().url())) return J(r, { data: [{ id: "grok-3" }, { id: "grok-4.1" }, { id: "grok-4.1-fast" }, { id: "grok-2-image" }, { id: "grok-4" }] });
    const body = JSON.parse(r.request().postData()); chats.push(body);
    const t = body.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    if (body.tools) {
      const first = !body.messages.some((m) => m.role === "tool");
      return J(r, { choices: [{ message: first ? { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "list_files", arguments: "{}" } }] } : { role: "assistant", content: "Grok looked at the files." } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    let out;
    if (/Design a style/.test(t)) out = { name: "Facts", emoji: "💡", description: "x", hookStyle: "shock", structure: "a,b", visualStyle: "bright", voiceStyle: "calm", captionStyle: "clean-white", musicStyle: "dark-drone", lengthSec: 20 };
    else if (/Score 1-10/.test(t)) out = { hook: 8, pacing: 8, escalation: 8, ending: 8, issues: [], pass: true };
    else if (/image prompt/.test(t)) { const n = Number((t.match(/exactly (\d+) items/) || [])[1] || 4); out = { scenes: Array.from({ length: n }, (_, i) => ({ visual: "x" + i, search: "x" })) }; }
    else out = { title: "Grok wrote this", lines: ["Honey never spoils.", "Archaeologists found 3000 year old honey.", "It was still edible.", "Bees are amazing."], caption: "honey", hashtags: ["#facts"] };
    return J(r, { choices: [{ message: { content: "<think>hmm</think>" + JSON.stringify(out) } }], usage: { prompt_tokens: 1000, completion_tokens: 300 } });
  });
  await ctx.route("https://api.openai.com/**", (r) => J(r, { error: "bad" }, 401));
  await ctx.route("https://api.deepseek.com/**", (r) => (r.request().headers()["authorization"] === "Bearer " + K.ds ? J(r, { data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }) : J(r, {}, 401)));
  for (const host of ["api.anthropic.com", "generativelanguage.googleapis.com", "api.elevenlabs.io", "api.pexels.com"]) await ctx.route(`https://${host}/**`, (r) => (r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: H }) : J(r, {}, 401)));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(APP); await p.waitForSelector("nav .link");
  await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(300);
  await p.fill("textarea[placeholder*='paste here']", `${K.xai}\nDEEPSEEK_API_KEY=${K.ds}\n${K.rep}\n${K.weird}`);
  await p.click("button:has-text('Add key')"); await p.waitForTimeout(6000);
  for (const t of await p.$$eval(".card .small[style*='border-radius:10px']", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()))) console.log("-", t.slice(0, 150));
  // name the unknown key
  await p.fill("input[placeholder*='name it']", "Runway"); await p.click("button:text-is('Save it')"); await p.waitForTimeout(500);
  console.log("unknown key:", (await p.locator("text=/Saved as “Runway”/").innerText()).slice(0, 80));
  await p.reload(); await p.waitForSelector("nav .link"); await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(500);
  console.log("after restart, your keys:", (await p.locator(".keyrow b").allInnerTexts()).join(" | "));
  console.log("xAI model picked:", await p.inputValue(".keyrow select >> nth=0"));
  // pick Grok for writer and chat
  await p.locator(".card", { has: p.locator("b:text-is('Writer')") }).locator(".roleopt-main:has(b:text-is('xAI (Grok)'))").click();
  await p.locator(".card", { has: p.locator("b:text-is('Change-the-app chat')") }).locator(".roleopt-main:has(b:text-is('xAI (Grok)'))").click();
  await p.screenshot({ path: OUT("custom1.png"), fullPage: true });
  await p.click("nav .link:has-text('Make')");
  await p.fill("textarea >> nth=0", "Make 1 fact about honey"); await p.click("button.chip:text-is('1')");
  await p.click("text=GENERATE VIDEOS"); await p.waitForSelector("text=All done", { timeout: 120000 });
  const v = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0]);
  console.log("video:", v.title, "| writer:", v.steps.script.provider, "| model sent:", chats.find((c) => !c.tools)?.model);
  await p.click("text=Change the app"); await p.waitForTimeout(300);
  await p.locator("#cf-shell textarea").fill("look at the files"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
  console.log("chat on Grok:", chats.filter((c) => c.tools).length, "calls | reply shown:", await p.isVisible("text=Grok looked at the files"));
  await b.close();
})().catch((e) => { console.log("FAIL", e.message.slice(0, 400)); process.exit(1); });
