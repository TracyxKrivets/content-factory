// The chat's first AI is out of credits: it should switch to the next AI you've added, and say so.
const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const { chromium } = require("playwright");
const ok = (c, m) => console.log((c ? "ok   " : "FAIL ") + m);
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await p.route("https://api.anthropic.com/**", (r) => r.request().method() === "OPTIONS" ? r.fulfill({ status: 200, headers: H }) :
    r.fulfill({ status: 400, headers: H, contentType: "application/json", body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } }) }));
  let openaiCalls = 0;
  await p.route("https://api.openai.com/**", (r) => {
    openaiCalls++;
    r.fulfill({ status: 200, headers: H, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Nothing to change, it already works." } }], usage: {} }) });
  });
  await p.addInitScript(() => localStorage.setItem("cf-keys", JSON.stringify({ ANTHROPIC_API_KEY: "sk-ant-api03-" + "a".repeat(80), OPENAI_API_KEY: "sk-proj-" + "b".repeat(60) })));
  await p.goto(APP);
  await p.waitForSelector("text=GENERATE VIDEOS");
  await p.click(".cfs-fab");
  await p.fill(".cfs-input textarea", "is the home page ok?");
  await p.click(".cfs-input button");
  await p.waitForSelector("text=Nothing to change, it already works.", { timeout: 20000 });
  ok(openaiCalls === 1, "switched to OpenAI after Anthropic ran out of credits");

  // only one AI, out of credits: clear message with where to top up
  await p.unroute("https://api.openai.com/**");
  await p.evaluate(() => localStorage.setItem("cf-keys", JSON.stringify({ ANTHROPIC_API_KEY: "sk-ant-api03-" + "a".repeat(80) })));
  await p.reload();
  await p.waitForSelector("text=GENERATE VIDEOS");
  await p.click(".cfs-fab").catch(() => {});
  await p.fill(".cfs-input textarea", "change something");
  await p.click(".cfs-input button");
  ok(await p.waitForSelector("text=/platform\\.claude\\.com\\/settings\\/billing/", { timeout: 20000 }).then(() => true, () => false), "says where to add Anthropic credits");
  await b.close();
})();
