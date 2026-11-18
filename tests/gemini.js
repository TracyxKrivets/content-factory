const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
// Gemini: paste key -> sorted + models discovered; no per-service key boxes; full video on Gemini; chat via OpenAI-compat with thought signatures.
const { chromium } = require("playwright"); const fs = require("fs");
const KEY = "AIza" + "SyD3mo_k3y-ABCDEFGHIJKLMNOPQRSTUVW".slice(0, 35);
const IMG = fs.readFileSync(FIX("gimg.png")).toString("base64");
const PCM = fs.readFileSync(FIX("gtts.pcm")).toString("base64");
const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-3.1-pro-preview", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-3.8-live", "text-embedding-005"];
const calls = []; const chatBodies = [];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await ctx.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request(), u = req.url();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    const auth = req.headers()["x-goog-api-key"] || (req.headers()["authorization"] || "").replace("Bearer ", "");
    if (auth !== KEY) return route.fulfill({ status: 400, headers: H, contentType: "application/json", body: JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }) });
    if (/\/models\?/.test(u)) return route.fulfill({ status: 200, headers: H, contentType: "application/json", body: JSON.stringify({ models: MODELS.map((m) => ({ name: "models/" + m, supportedGenerationMethods: m.startsWith("text-") ? ["embedContent"] : ["generateContent"] })) }) });
    if (/openai\/chat\/completions/.test(u)) {
      const body = JSON.parse(req.postData()); chatBodies.push(body);
      const first = body.messages.filter((m) => m.role === "tool").length === 0;
      const msg = first
        ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_files", arguments: "{}" }, extra_content: { google: { thought_signature: "SIG123" } } }] }
        : { role: "assistant", content: "I looked at the files. Nothing to change." };
      return route.fulfill({ status: 200, headers: H, contentType: "application/json", body: JSON.stringify({ choices: [{ message: msg }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) });
    }
    const model = u.match(/models\/([^:]+):generateContent/)[1];
    const body = JSON.parse(req.postData()); calls.push(model);
    const t = (body.systemInstruction?.parts?.[0]?.text || "") + body.contents[0].parts.map((p) => p.text || "").join("");
    let parts;
    if (/image/.test(model)) parts = [{ inlineData: { mimeType: "image/png", data: IMG } }];
    else if (/tts/.test(model)) parts = [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: PCM } }];
    else {
      let out;
      if (/Design a style/.test(t)) out = { name: "Space facts", emoji: "🚀", description: "x", hookStyle: "shock fact", structure: "fact, why, twist", visualStyle: "deep space", voiceStyle: "calm", captionStyle: "clean-white", musicStyle: "dark-drone", lengthSec: 20 };
      else if (/Score 1-10/.test(t)) out = { hook: 8, pacing: 8, escalation: 8, ending: 8, issues: [], pass: true };
      else if (/image prompt/.test(t)) { const n = Number((t.match(/exactly (\d+) items/) || [])[1] || 4); out = { scenes: Array.from({ length: n }, (_, i) => ({ visual: "nebula " + i, search: "space" })) }; }
      else out = { title: "Saturn would float", lines: ["Saturn would float in a bathtub.", "It is less dense than water.", "But you would need a bathtub bigger than the solar system.", "Follow for more space facts."], caption: "Saturn floats", hashtags: ["#space"] };
      parts = [{ text: "thinking...", thought: true }, { text: JSON.stringify(out) }];
    }
    return route.fulfill({ status: 200, headers: H, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 50 } }) });
  });
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(APP); await p.waitForSelector("nav .link");
  await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(400);
  console.log("separate key boxes on page:", await p.locator("input[placeholder='Paste key']").count());
  // a bad Gemini key first, then the real one
  await p.fill("textarea[placeholder*='paste here']", "AIza" + "x".repeat(35)); await p.click("button:has-text('Add key')"); await p.waitForTimeout(1500);
  console.log("bad key:", (await p.textContent("text=/rejected it/")).trim().slice(0, 90));
  await p.fill("textarea[placeholder*='paste here']", "GEMINI_API_KEY=" + KEY); await p.click("button:has-text('Add key')"); await p.waitForTimeout(2000);
  console.log("good key:", (await p.textContent("text=/Google Gemini key saved/")).trim().slice(0, 110));
  console.log("keys list shows:", await p.isVisible("text=Your keys (sorted automatically)"), "| writer option says:", await p.isVisible("text=✓ Google Gemini key added"));
  console.log("discovered:", await p.evaluate(() => localStorage.getItem("cf-gemini-models")));
  for (const [role, label] of [["Writer", "Google Gemini"], ["Voice", "Gemini voice"], ["Visuals", "Gemini images (Nano Banana)"], ["Change-the-app chat", "Google Gemini"]])
    await p.locator(".card", { has: p.locator(`b:text-is('${role}')`) }).locator(`.roleopt-main:has(b:text-is('${label}'))`).click();
  console.log("roles:", await p.evaluate(() => localStorage.getItem("cf-roles")), "| flash/pro chips:", await p.isVisible("text=/Flash fast, cheap/"));
  await p.screenshot({ path: OUT("g1.png"), fullPage: true });
  await p.click("nav .link:has-text('Make')");
  await p.fill("textarea >> nth=0", "Make 1 space fact");
  await p.click("button.chip:text-is('1')");
  await p.click("text=GENERATE VIDEOS");
  await p.waitForSelector("text=All done", { timeout: 200000 });
  const v = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0]);
  console.log("providers:", Object.entries(v.steps).map(([k, s]) => k + "=" + s.provider).join(" "));
  console.log("voice secs:", v.steps.voice.output.duration.toFixed(1), "| final:", JSON.stringify(v.steps.assemble.output).slice(0, 120));
  console.log("models called:", [...new Set(calls)].join(", "));
  // chat
  await p.click("text=Change the app"); await p.waitForTimeout(300);
  await p.fill(".cfs-input textarea, textarea.cfs-ta, #cfs-input, .cfs textarea", "look at the files").catch(async () => { await p.locator("#cf-shell textarea").fill("look at the files"); });
  await p.keyboard.press("Enter"); await p.waitForTimeout(4000);
  console.log("chat calls:", chatBodies.length, "| model:", chatBodies[0]?.model, "| signature sent back:", JSON.stringify(chatBodies[1]?.messages.find((m) => m.tool_calls)?.tool_calls?.[0]?.extra_content || null));
  console.log("chat reply shown:", await p.isVisible("text=Nothing to change"));
  await b.close();
})().catch((e) => { console.log("FAIL", e.message.slice(0, 400)); process.exit(1); });
