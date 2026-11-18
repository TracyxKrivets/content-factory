const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await ctx.route("https://generativelanguage.googleapis.com/**", (r) => r.fulfill({ status: 200, headers: H, contentType: "application/json", body: JSON.stringify({ models: [] }) }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const url = APP;
  const show = async (label) => {
    await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(500);
    const cards = await p.$$eval(".card", (cs) => cs.filter((c) => c.querySelector(".roleopt") || /No APIs added yet/.test(c.innerText)).map((c) => {
      const t = c.querySelector("b")?.innerText; const opts = [...c.querySelectorAll(".roleopt b")].map((x) => x.innerText); return t + (opts.length ? ": " + opts.join(", ") : "");
    }));
    console.log(label, "\n   cards:", cards.join(" || "));
    console.log("   footer:", ((await p.locator("text=/Nothing added yet for/").innerText().catch(() => "(none)"))).slice(0, 230));
  };
  await p.goto(url); await p.waitForSelector("nav .link");
  await show("A. no keys:");
  await p.evaluate(() => { localStorage.setItem("cf-keys", JSON.stringify({ GEMINI_API_KEY: "AIza" + "Q".repeat(35) })); localStorage.setItem("cf-roles", JSON.stringify({ voice: "no-voice", writer: "offline-writer" })); });
  await p.reload(); await p.waitForSelector("nav .link");
  await show("B. Gemini key + old 'No voice' pick:");
  console.log("   saved picks now:", await p.evaluate(() => localStorage.getItem("cf-roles")));
  await p.screenshot({ path: OUT("mine.png"), fullPage: true });
  await b.close();
})();
