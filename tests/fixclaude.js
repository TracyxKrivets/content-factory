const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
const ok = (c, m) => console.log((c ? "ok   " : "FAIL ") + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.addInitScript(() => {
    localStorage.setItem("cf-keys", JSON.stringify({ OPENAI_API_KEY: "sk-SECRET-should-never-leak-1234567890" }));
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
  });
  await p.goto(APP);
  await p.waitForSelector("text=GENERATE VIDEOS", { timeout: 15000 });

  const fab = p.locator(".cfs-fab");
  ok((await fab.innerText()).includes("Fix with Claude"), "corner button says Fix with Claude");
  await fab.click();
  ok(await p.locator(".cfs-tab.on", { hasText: "Claude" }).count() === 1, "opens on the Claude tab");
  const btn = p.locator("button", { hasText: "Open Claude" });
  ok(await btn.isDisabled(), "Open Claude waits for a request");

  await p.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "Boom: test crash in Money page" })));
  await p.fill(".cfs-ta", "the Money page shows the wrong total");
  await btn.click();
  await p.waitForTimeout(500);
  const urls = await p.evaluate(() => window.__opened);
  ok(urls.length === 1, "opened one link");
  const u = new URL(urls[0] || "https://x/");
  ok(u.origin + u.pathname === "https://claude.ai/code", "goes to Claude Code: " + u.origin + u.pathname);
  ok(u.searchParams.get("repositories") === "TracyxKrivets/content-factory", "repo filled in: " + u.searchParams.get("repositories"));
  const prompt = u.searchParams.get("prompt") || "";
  ok(prompt.includes("the Money page shows the wrong total"), "request is in the prompt");
  ok(/App version/.test(prompt) && /Device/.test(prompt), "app details are included");
  ok(prompt.includes("Boom: test crash"), "recent error is included");
  ok(/CLAUDE\.md/.test(prompt) && /push/.test(prompt), "asks Claude to follow CLAUDE.md and push");
  ok(!prompt.includes("SECRET") && !urls[0].includes("SECRET"), "API key never included");
  ok(await p.locator(".cfs-banner.ok").count() === 1, "shows the sent message");
  await p.screenshot({ path: OUT("fixclaude.png") });

  // details can be turned off
  await p.click("text=Ask for something else");
  await p.fill(".cfs-ta", "add dark mode");
  await p.locator(".cfs-check input").uncheck();
  await p.click("button:has-text('Open Claude')");
  await p.waitForTimeout(300);
  const p2 = new URL((await p.evaluate(() => window.__opened))[1]).searchParams.get("prompt");
  ok(p2.includes("add dark mode") && !/App version/.test(p2), "details left out when unticked");

  // tab choice is remembered, quick tab has the chat box
  await p.click(".cfs-tab:nth-child(2)");
  ok(await p.locator(".cfs-input textarea").count() === 1, "Quick change tab has the chat box");
  await b.close();
})();
