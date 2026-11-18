const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
// Budget stops paid work; raising it resumes; ledger by service; bills from ElevenLabs/OpenAI/Anthropic admin; offline pause + resume.
const { chromium } = require("playwright");
const K = { ant: "sk-ant-api03-" + "a".repeat(80), antAdmin: "sk-ant-admin01-" + "b".repeat(60), oaiAdmin: "sk-admin-" + "c".repeat(60), xi: "sk_" + "0123456789abcdef".repeat(3) };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  const J = (r, body, status = 200) => r.fulfill({ status, headers: H, contentType: "application/json", body: JSON.stringify(body) });
  let llmCalls = 0;
  await ctx.route("https://api.anthropic.com/**", async (r) => {
    const u = r.request().url();
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: H });
    if (/cost_report/.test(u)) return r.request().headers()["x-api-key"] === K.antAdmin ? J(r, { data: [{ results: [{ amount: "1234.5", currency: "USD" }] }, { results: [{ amount: "300", currency: "USD" }] }], has_more: false }) : J(r, { error: {} }, 401);
    const body = JSON.parse(r.request().postData() || "{}");
    if (body.max_tokens === 1) return J(r, { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } });
    llmCalls++;
    const t = (body.system || "") + JSON.stringify(body.messages);
    let out;
    if (/Design a style/.test(t)) out = { name: "Facts", emoji: "💡", description: "x", hookStyle: "shock", structure: "a,b", visualStyle: "bright", voiceStyle: "calm", captionStyle: "clean-white", musicStyle: "dark-drone", lengthSec: 20 };
    else if (/Score 1-10/.test(t)) out = { hook: 8, pacing: 8, escalation: 8, ending: 8, issues: [], pass: true };
    else if (/image prompt/.test(t)) { const n = Number((t.match(/exactly (\d+) items/) || [])[1] || 4); out = { scenes: Array.from({ length: n }, (_, i) => ({ visual: "x" + i, search: "x" })) }; }
    else out = { title: "Octopus hearts", lines: ["Octopuses have three hearts.", "Two pump blood to the gills.", "One pumps it to the body.", "And it stops when they swim."], caption: "3 hearts", hashtags: ["#ocean"] };
    // big usage so each call costs ~$0.135 with Sonnet
    return J(r, { content: [{ type: "text", text: JSON.stringify(out) }], usage: { input_tokens: 20000, output_tokens: 5000 } });
  });
  await ctx.route("https://api.openai.com/**", (r) => (/organization\/costs/.test(r.request().url()) && r.request().headers()["authorization"] === "Bearer " + K.oaiAdmin
    ? J(r, { data: [{ results: [{ amount: { value: 4.2, currency: "usd" } }] }, { results: [{ amount: { value: 1.3, currency: "usd" } }] }], has_more: false }) : J(r, {}, 401)));
  const XI = require("fs").readFileSync(FIX("xi.wav"));
  await ctx.route("https://api.elevenlabs.io/**", (r) => (/text-to-speech/.test(r.request().url()) ? (async () => { await new Promise((z) => setTimeout(z, 2500)); return r.fulfill({ status: 200, headers: H, contentType: "audio/mpeg", body: XI }).catch(() => {}); })() : /subscription/.test(r.request().url())
    ? J(r, { tier: "creator", status: "active", character_count: 81000, character_limit: 100000, next_character_count_reset_unix: 1796000000, currency: "usd", has_open_invoices: true, next_invoice: { amount_due_cents: 2200, next_payment_attempt_unix: 1796000000 } }) : J(r, {})));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const popups = []; ctx.on("page", (pg) => popups.push(pg.url()));
  await p.goto(APP); await p.waitForSelector("nav .link");
  await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(300);
  await p.fill("textarea[placeholder*='paste here']", `${K.ant}\nANTHROPIC_ADMIN_KEY=${K.antAdmin}\n${K.oaiAdmin}\n${K.xi}`);
  await p.click("button:has-text('Add key')"); await p.waitForTimeout(2500);
  console.log("filed:", await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("cf-keys"))).join(",")));
  console.log("admin message:", (await p.textContent("text=/Anthropic billing \\(admin\\) key saved/")).slice(0, 120));
  // budget
  await p.click("nav .link:has-text('Money')"); await p.waitForTimeout(800);
  await p.fill("input[placeholder*='no limit']", "0.30"); await p.click("button:text-is('Save')"); await p.waitForTimeout(300);
  await p.click("nav .link:has-text('Make')");
  await p.fill("textarea >> nth=0", "Make 1 ocean fact"); await p.click("button.chip:text-is('1')");
  console.log("make page cost line:", (await p.textContent("text=/About \\$|Free with/")).replace(/\s+/g, " ").trim().slice(0, 120));
  await p.click("text=GENERATE VIDEOS");
  await p.waitForSelector("text=/budget is used up/", { timeout: 60000 });
  const st = await p.evaluate(async () => { const v = (await window.__cf.db.all("videos"))[0]; return Object.entries(v.steps).map(([k, s]) => k + ":" + s.status).join(" ") + " | " + v.status; });
  console.log("stopped at budget:", st, "| llm calls:", llmCalls);
  await p.click("nav .link:has-text('Money')"); await p.waitForTimeout(1200);
  console.log("money nav red dot:", await p.locator("nav .link:has-text('Money') .dot").count());
  await p.screenshot({ path: OUT("m1.png"), fullPage: true });
  console.log("bills:", (await p.locator(".card").allTextContents()).filter((t) => /Billed|Characters|plan/.test(t)).map((t) => t.replace(/\s+/g, " ").slice(0, 160)).join("\n   "));
  await p.click("button:has-text('Pay / add credits') >> nth=0"); await p.waitForTimeout(800);
  console.log("pay opened:", popups.slice(-1)[0], "| app still on money page:", p.url().endsWith("#money"));
  // raise budget, try again
  await p.fill("input[placeholder*='no limit']", "5"); await p.click("button:text-is('Save')");
  await p.click("nav .link:has-text('Projects')"); await p.waitForTimeout(300); await p.click(".prow >> nth=0").catch(() => p.click("text=ocean"));
  await p.waitForTimeout(500);
  // drop the internet, then try again: it should wait, not fail or switch to free options
  await ctx.setOffline(true); await p.waitForTimeout(500);
  await p.click("button:has-text('TRY AGAIN') >> nth=0");
  console.log("offline banner:", await p.isVisible("text=/No internet/"));
  await p.waitForTimeout(4000);
  const mid = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0]);
  console.log("while offline: steps", Object.entries(mid.steps).map(([k, s]) => k + ":" + s.status).join(" "), "| status", mid.status, "| errors:", Object.entries(mid.steps).filter(([, s]) => s.status === "error").map(([k]) => k).join(",") || "none");
  await ctx.setOffline(false);
  await p.waitForSelector("text=All done", { timeout: 120000 });
  const v = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0]);
  console.log("after back online:", v.status, "| providers:", Object.entries(v.steps).map(([k, s]) => k + "=" + s.provider).join(" "));
  const led = await p.evaluate(async () => window.__cf.kv.get("spend:" + new Date().toISOString().slice(0, 7)));
  console.log("ledger:", JSON.stringify(led));
  await b.close();
})().catch((e) => { console.log("FAIL", e.message.slice(0, 500)); process.exit(1); });
