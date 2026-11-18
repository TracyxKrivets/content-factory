// In-app change → "Put it on all my devices" → commit on GitHub (GitHub is simulated here).
const path = require("path");
const fs = require("fs");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright");
const ok = (c, m) => console.log((c ? "ok   " : "FAIL ") + m);
const ROOT = path.join(__dirname, "..");
const TOKEN = "ghp_" + "T".repeat(36);
const REPO = "TracyxKrivets/content-factory";

// fake repository: path -> text, plus commits
const repo = {};
for (const f of fs.readdirSync(path.join(ROOT, "web/src")).filter((f) => f.endsWith(".js"))) repo["web/src/" + f] = fs.readFileSync(path.join(ROOT, "web/src", f), "utf8");
repo["web/style.css"] = fs.readFileSync(path.join(ROOT, "web/style.css"), "utf8");
let head = "c0";
const snapshots = { c0: { ...repo } };
const commits = [];
let buildState = "in_progress";

const mock = (plan) => `window.__cfStep = 0; window.__cfMockAgent = async (system, messages) => {
  const plan = ${JSON.stringify(plan)}; const s = plan[Math.min(window.__cfStep++, plan.length - 1)];
  sessionStorage.setItem("lastMsgs", JSON.stringify(messages));
  return { content: s.tool ? [{ type: "tool_use", id: "t" + window.__cfStep, name: s.tool, input: s.input }] : [{ type: "text", text: s.text }], stop: s.tool ? "tool_use" : "end_turn", cost: 0.004 };
};`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (r, status, body) => r.fulfill({ status, headers: H, contentType: "application/json", body: JSON.stringify(body) });
  await ctx.route("https://api.github.com/**", async (r) => {
    const req = r.request();
    if (req.method() === "OPTIONS") return json(r, 200, {});
    if (req.headers()["authorization"] !== "Bearer " + TOKEN) return json(r, 401, { message: "Bad credentials" });
    const u = new URL(req.url());
    const p = u.pathname.replace(`/repos/${REPO}`, "");
    if (u.pathname === "/user") return json(r, 200, { login: "TracyxKrivets" });
    if (p === "" ) return json(r, 200, { permissions: { push: true } });
    if (p === "/git/ref/heads/main") return json(r, 200, { object: { sha: head } });
    if (p.startsWith("/contents/")) {
      const file = snapshots[u.searchParams.get("ref")]?.[p.slice(10)];
      return file == null ? json(r, 404, {}) : r.fulfill({ status: 200, headers: H, contentType: "text/plain", body: file });
    }
    if (p.startsWith("/git/commits/") && req.method() === "GET") return json(r, 200, { tree: { sha: "tree-" + p.slice(13) } });
    if (p === "/git/trees") {
      const body = req.postDataJSON();
      const t = "tree" + commits.length;
      snapshots["pending-" + t] = body;
      return json(r, 201, { sha: t });
    }
    if (p === "/git/commits") {
      const body = req.postDataJSON();
      const sha = "c" + (commits.length + 1);
      const tree = snapshots["pending-" + body.tree];
      const next = { ...snapshots[body.parents[0]] };
      for (const e of tree.tree) (e.sha === null ? delete next[e.path] : (next[e.path] = e.content));
      snapshots[sha] = next;
      commits.push({ sha, message: body.message, paths: tree.tree.map((e) => e.path), parent: body.parents[0] });
      return json(r, 201, { sha });
    }
    if (p === "/git/refs/heads/main" && req.method() === "PATCH") {
      head = req.postDataJSON().sha;
      return json(r, 200, { object: { sha: head } });
    }
    if (p === "/actions/runs") return json(r, 200, { workflow_runs: [{ status: buildState === "success" ? "completed" : "in_progress", conclusion: buildState === "success" ? "success" : null }] });
    return json(r, 404, { message: "not mocked " + p });
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.addInitScript(() => { window.__opened = []; window.open = (u) => (window.__opened.push(u), null); });
  await p.goto(APP);
  await p.waitForSelector("text=GENERATE VIDEOS");

  // 1. one panel, no Claude website
  await p.click(".cfs-fab");
  ok((await p.locator(".cfs-head b").innerText()).includes("Change the app"), "panel title is Change the app");
  ok((await p.locator(".cfs-tab").count()) === 0, "no tabs / no Claude-website option");
  ok((await p.locator(".cfs-input textarea").count()) === 1, "chat box is right there");

  // 2. make a change on this device
  await p.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "Boom: test crash in Money page" })));
  await p.evaluate(mock([
    { tool: "edit_file", input: { name: "60-pages.js", old_text: "What do you want to make?</h1>", new_text: "What are we making today?</h1>" } },
    { text: "I changed the big question on the home page." },
  ]));
  await p.fill(".cfs-input textarea", "change the heading");
  await p.click(".cfs-input button");
  await p.waitForEvent("load", { timeout: 20000 });
  await p.waitForSelector("text=What are we making today?");
  await p.waitForTimeout(800);
  const lastMsgs = await p.evaluate(() => sessionStorage.getItem("lastMsgs") || "");
  ok(/Details from the app/.test(lastMsgs) && /Boom: test crash/.test(lastMsgs), "AI got the app's details and recent errors");
  ok(!/sk-|ghp_/.test(lastMsgs), "no keys sent to the AI");
  ok(await p.locator(".cfs-panel").count() === 1, "panel reopened after the change");
  const pub = p.locator("button", { hasText: "Put it on all my devices" });
  ok(await pub.count() === 1, "shows Put it on all my devices");
  ok(/only on this device/.test(await p.locator(".cfs-pub").innerText()), "says it's only on this device");
  await p.screenshot({ path: OUT("publish-1.png") });

  // 3. first time: asks for a GitHub key, inside the app
  await pub.click();
  await p.waitForSelector("text=One-time step: connect GitHub");
  await p.click("button:has-text('Get GitHub key')");
  ok((await p.evaluate(() => window.__opened[0] || "")).startsWith("https://github.com/settings/tokens/new?scopes=repo"), "Get GitHub key opens the right page");
  await p.fill(".cfs-key", "not-a-key");
  await p.click("text=Save and send");
  ok(await p.locator(".cfs-banner.bad", { hasText: "doesn't look like a GitHub key" }).count() === 1, "rejects something that isn't a key");
  await p.screenshot({ path: OUT("publish-2-key.png") });
  await p.fill(".cfs-key", TOKEN);
  await p.click("text=Save and send");
  await p.waitForSelector(".cfs-banner.ok >> text=Sent to all your devices", { timeout: 15000 });
  ok(commits.length === 1 && head === "c1", "made one commit on main");
  ok(commits[0]?.paths.join() === "web/src/60-pages.js", "commit has only the changed file: " + commits[0]?.paths);
  ok(snapshots.c1["web/src/60-pages.js"].includes("What are we making today?</h1>"), "the change is in the commit");
  ok(/^App change: /.test(commits[0]?.message), "commit message: " + commits[0]?.message.split("\n")[0]);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("cf-keys")).GITHUB_TOKEN) === TOKEN, "GitHub key saved with the other keys");
  ok(/on all your devices/.test(await p.locator(".cfs-sub").innerText()), "header says it's on all devices");
  buildState = "success";
  await p.waitForSelector("text=Your change is ready on all devices", { timeout: 30000 });
  ok(true, "build progress shown until ready");
  await p.screenshot({ path: OUT("publish-3-sent.png") });
  await p.click(".cfs-banner.ok button:has-text('OK')");

  // 4. a second change: only the new part is sent, no key question
  await p.evaluate(mock([
    { tool: "edit_file", input: { name: "60-pages.js", old_text: "What are we making today?</h1>", new_text: "Let's make videos!</h1>" } },
    { tool: "write_file", input: { name: "65-extra.js", content: "// extra feature\n" } },
    { text: "Changed it again and added a small file." },
  ]));
  await p.fill(".cfs-input textarea", "change it again");
  await p.click(".cfs-input button");
  await p.waitForEvent("load", { timeout: 20000 });
  await p.waitForSelector("text=Let's make videos!");
  await p.waitForTimeout(800);
  await p.click("button:has-text('Put it on all my devices')");
  await p.waitForSelector(".cfs-banner.ok >> text=Sent to all your devices", { timeout: 15000 }).catch(() => {});
  await p.screenshot({ path: OUT("publish-3b.png") });
  ok(commits.length === 2 && commits[1].parent === "c1", "second commit on top of the first");
  ok(commits[1]?.paths.sort().join() === "web/src/60-pages.js,web/src/65-extra.js", "second commit has the edit and the new file: " + commits[1].paths);

  // 5. someone else changed the same file meanwhile: refuse instead of undoing their update
  snapshots.c9 = { ...snapshots[head], "web/src/60-pages.js": snapshots[head]["web/src/60-pages.js"] + "\n// changed on another device\n" };
  head = "c9";
  await p.evaluate(mock([
    { tool: "edit_file", input: { name: "60-pages.js", old_text: "Let's make videos!</h1>", new_text: "Third time!</h1>" } },
    { text: "Changed it a third time." },
  ]));
  await p.fill(".cfs-input textarea", "third change");
  await p.click(".cfs-input button");
  await p.waitForEvent("load", { timeout: 20000 });
  await p.waitForSelector("text=Third time!");
  await p.waitForTimeout(800);
  await p.click("button:has-text('Put it on all my devices')");
  await p.waitForSelector(".cfs-banner.bad", { timeout: 15000 });
  ok(/got an update/.test(await p.locator(".cfs-banner.bad").innerText()) && head === "c9", "won't overwrite a newer update");

  // 6. Connect AI recognises a pasted GitHub key
  await p.evaluate(() => localStorage.setItem("cf-keys", "{}"));
  await p.click(".cfs-head button[title='Close']");
  await p.click("nav .link:has-text('Connect')");
  await p.waitForTimeout(300);
  await p.fill("textarea[placeholder*='paste here']", TOKEN);
  await p.click("button:has-text('Add key')");
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("cf-keys")).GITHUB_TOKEN) === "ghp_" + "T".repeat(36), "Paste any API key files a GitHub key as GitHub");
  await p.screenshot({ path: OUT("publish-4-keys.png"), fullPage: true });
  await b.close();
})();
