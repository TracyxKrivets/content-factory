const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
const K = {
  ant: "sk-ant-api03-" + "a".repeat(80), antBad: "sk-ant-api03-" + "b".repeat(80),
  oai: "sk-proj-" + "Xy7".repeat(30), xi: "sk_" + "0123456789abcdef".repeat(3), px: "P".repeat(20) + "q1".repeat(18),
  weird: "zz9" + "Q".repeat(37), google: "AIza" + "S".repeat(35),
};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  const ok = (r) => r.fulfill({ status: 200, headers: H, contentType: "application/json", body: "{}" });
  const no = (r) => r.fulfill({ status: 401, headers: H, contentType: "application/json", body: "{}" });
  await ctx.route("https://api.anthropic.com/**", (r) => (r.request().method() === "OPTIONS" ? ok(r) : r.request().headers()["x-api-key"] === K.ant ? ok(r) : no(r)));
  await ctx.route("https://api.openai.com/**", (r) => (r.request().headers()["authorization"] === "Bearer " + K.oai ? ok(r) : no(r)));
  await ctx.route("https://api.elevenlabs.io/**", (r) => ([K.xi, K.weird].includes(r.request().headers()["xi-api-key"]) ? ok(r) : no(r)));
  await ctx.route("https://api.pexels.com/**", (r) => (r.request().headers()["authorization"] === K.px ? ok(r) : no(r)));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(APP); await p.waitForSelector("nav .link");
  await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(400);
  const paste = `# my keys\nOPENAI_API_KEY=${K.oai}\nclaude: ${K.ant}\n${K.xi}, ${K.px}\nsome key ${K.weird}\n${K.google}\nold claude ${K.antBad}`;
  await p.fill("textarea[placeholder*='paste here']", paste);
  await p.click("button:has-text('Add key')");
  await p.waitForSelector("text=/Which is it|Used for/", { timeout: 30000 }); await p.waitForTimeout(3000);
  for (const t of await p.$$eval(".card .small[style*='border-radius:10px']", (els) => els.map((e) => e.textContent.trim()))) console.log("-", t.slice(0, 150));
  console.log("saved:", JSON.stringify(await p.evaluate(() => Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem("cf-keys"))).map(([k, v]) => [k, v.slice(0, 8)])))));
  console.log("textarea cleared:", (await p.inputValue("textarea[placeholder*='paste here']")) === "");
  await p.screenshot({ path: OUT("keys.png"), fullPage: true });
  await b.close();
})();
