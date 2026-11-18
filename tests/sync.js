const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
// Two devices (separate storage): a PC that makes videos and an Android phone that watches and edits.
const { chromium, devices } = require("playwright"); const fs = require("fs");
const URL = APP;
const ADAPTER = fs.readFileSync(path.join(__dirname, "syncadapter.js"), "utf8");
const S = "http://127.0.0.1:8787";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const vids = (p) => p.evaluate(async () => (await window.__cf.db.all("videos")).map((v) => ({ id: v.id, status: v.status, title: v.title, line1: v.steps.script.output?.lines?.[0], worker: v.worker?.name, cloud: !!v.cloud, key: v.steps.assemble.output?.key, projectId: v.projectId })));
const projs = (p) => p.evaluate(async () => (await window.__cf.db.all("projects")).map((x) => ({ id: x.id, title: x.title, status: x.status, deleted: !!x.deletedAt })));
async function until(fn, ms = 120000, what = "") { const t0 = Date.now(); for (;;) { const r = await fn(); if (r) return r; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await wait(700); } }
(async () => {
  const b = await chromium.launch();
  const pcCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const phCtx = await b.newContext({ ...devices["Pixel 7"] });
  for (const c of [pcCtx, phCtx]) await c.addInitScript(ADAPTER);
  const pc = await pcCtx.newPage(), ph = await phCtx.newPage();
  for (const [n, p] of [["PC", pc], ["PHONE", ph]]) p.on("pageerror", (e) => console.log(n, "PAGEERROR", e.message));
  await pc.goto(URL); await pc.waitForSelector("nav .link");

  // 0. the PC already has a finished project before sync is set up
  await pc.fill("textarea >> nth=0", "Make 1 fun fact about owls"); await pc.click("button.chip:text-is('1')");
  await pc.click("text=GENERATE VIDEOS"); await pc.waitForSelector("text=All done", { timeout: 120000 });
  console.log("0. PC made a video before sync:", (await vids(pc))[0].title);

  // 1. PC sets up sync
  await pc.click("nav .link:has-text('Connect')"); await pc.waitForTimeout(300);
  await pc.click("text=Set up sync (first device)");
  console.log("1. setup steps shown:", await pc.isVisible("text=Copy setup SQL"));
  await pc.fill("input[placeholder*='supabase.co']", S); await pc.fill("input[placeholder*='anon public key']", "test-anon-key-1234567890");
  await pc.click("button:text-is('Connect')"); await pc.waitForSelector("text=Now sign in");
  await pc.fill("input[type=email]", "tracy@example.com"); await pc.fill("input[type=password]", "secret123");
  await pc.click(".syncard button:text-is('Make account')");
  await pc.waitForSelector(".syncpill:has-text('Synced')", { timeout: 20000 });
  console.log("   PC pill:", await pc.textContent(".nav .syncpill"), "| QR shown:", await pc.isVisible(".qr svg"));
  const stats1 = await (await fetch(S + "/stats")).json();
  await until(async () => (await (await fetch(S + "/stats")).json()).files.length > 0, 30000, "upload");
  console.log("   cloud now has rows:", stats1.rows, "| video files:", (await (await fetch(S + "/stats")).json()).files.length);
  const code = await pc.evaluate(() => __cf.Sync.pairCode());

  // 2. phone pairs with the code and signs in
  await ph.goto(URL); await ph.waitForSelector("nav .link");
  await ph.click("nav .link:has-text('Connect')"); await ph.waitForTimeout(300);
  await ph.click("text=I set it up on another device");
  await ph.fill("input[placeholder*='pairing code']", code); await ph.click("button:text-is('Use code')");
  await ph.waitForSelector("text=Now sign in");
  await ph.fill("input[type=email]", "tracy@example.com"); await ph.fill("input[type=password]", "wrongpass");
  await ph.click(".syncard button:text-is('Sign in')"); await ph.waitForTimeout(800);
  await ph.screenshot({ path: OUT("s-wrongpw.png"), fullPage: true });
  console.log("2. wrong password:", (await ph.locator(".syncard").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await ph.fill("input[type=password]", "secret123"); await ph.click(".syncard button:text-is('Sign in')");
  await ph.waitForSelector(".syncpill:has-text('Synced')", { timeout: 20000 });
  await ph.screenshot({ path: OUT("s-phone-connect.png"), fullPage: true });
  const phV = await until(async () => (await vids(ph)).length && (await vids(ph)), 20000, "phone gets PC video");
  console.log("   phone sees PC's video:", phV[0].title, "| status", phV[0].status, "| phone makes videos:", await ph.evaluate(() => __cf.Sync.cfg().worker), "| devices:", await ph.evaluate(() => Object.values(__cf.Sync.st.devices).map((d) => d.name + (d.worker ? "*" : "")).join(",")));
  await ph.click("nav .link:has-text('Projects')"); await ph.waitForTimeout(300); await ph.click(".prow >> nth=0").catch(() => ph.click("text=owls"));
  await ph.waitForSelector(".vcard video", { timeout: 30000 });
  console.log("   phone can play the PC's video:", await ph.locator(".vcard video").count());

  // 3. phone starts a project; the PC plans and makes it; the phone watches live
  await ph.click("nav .link:has-text('Make')");
  await ph.fill("textarea >> nth=0", "Make 1 video about why cats purr"); await ph.click("button.chip:text-is('1')");
  await ph.click("text=GENERATE VIDEOS");
  await ph.waitForTimeout(2500);
  const phonePlanned = await ph.evaluate(async () => (await window.__cf.db.all("projects")).find((p) => /purr/.test(p.request)));
  console.log("3. phone left planning to the PC:", phonePlanned.worker?.name || "(not claimed by phone)");
  let sawLive = null, sawOnPc = false;
  await until(async () => {
    const t = await ph.locator(".vcard").first().innerText().catch(() => "");
    if (/on PC/.test(t)) sawOnPc = true;
    const lv = await ph.evaluate(() => Object.values(__cf.live).map((x) => x.render).find((r) => r > 0));
    if (lv) sawLive = lv;
    return (await vids(ph)).some((v) => /purr|cat/i.test(v.title) && v.status === "done" && v.cloud);
  }, 180000, "PC makes phone's video");
  const made = (await vids(ph)).find((v) => /purr|cat/i.test(v.title));
  console.log("   made by:", made.worker, "| phone saw 'on PC':", sawOnPc, "| phone saw live render %:", sawLive ? Math.round(sawLive * 100) + "%" : "no");
  await ph.waitForSelector(`.vcard video`, { timeout: 30000 });
  await ph.screenshot({ path: OUT("s-phone-project.png"), fullPage: true });

  // 4. phone edits the script; PC remakes it
  const before = made.key;
  await ph.evaluate(async (id) => { const v = await window.__cf.db.get("videos", id); await __cf.editScript(id, { title: v.title, lines: ["EDITED ON PHONE: cats purr at 25 to 150 hertz.", ...v.steps.script.output.lines.slice(1)], caption: v.steps.script.output.caption }); }, made.id);
  const remade = await until(async () => { const v = (await vids(pc)).find((x) => x.id === made.id); return v && v.status === "done" && v.key !== before && v; }, 120000, "remake");
  console.log("4. PC remade after phone edit:", remade.line1.slice(0, 40));
  await until(async () => { const v = (await vids(ph)).find((x) => x.id === made.id); return v && v.key === remade.key && v.cloud; }, 60000, "phone gets remake");
  console.log("   phone has the new version:", ((await vids(ph)).find((x) => x.id === made.id)).line1.slice(0, 16));

  // 5. settings sync both ways, deleting syncs
  await ph.evaluate(() => __cf.saveSetting("cf-budget", { monthly: 12 }));
  await until(async () => (await pc.evaluate(() => __cf.budget().monthly)) === 12, 15000, "budget");
  console.log("5. budget set on phone, PC has:", await pc.evaluate(() => __cf.budget().monthly));
  const owl = (await projs(ph)).find((x) => /owl/i.test(x.title));
  await ph.evaluate((id) => __cf.update("projects", id, (c) => ({ deletedAt: new Date().toISOString(), rev: (c.rev || 0) + 1 })), owl.id);
  await until(async () => (await projs(pc)).find((x) => x.id === owl.id)?.deleted, 15000, "delete");
  console.log("   deleted on phone -> in trash on PC:", (await projs(pc)).find((x) => x.id === owl.id).deleted);

  // 6. PC closed: phone's new work waits, then starts when the PC opens again
  await pc.close();
  await ph.evaluate(async () => { const d = __cf.Sync.st.devices; for (const k in d) if (k !== __cf.Sync.me.id) d[k].lastSeen = new Date(Date.now() - 600000).toISOString(); });
  await ph.click("nav .link:has-text('Make')");
  await ph.fill("textarea >> nth=0", "Make 1 video about sleepy otters"); await ph.click("text=GENERATE VIDEOS");
  await ph.waitForTimeout(2000);
  console.log("6. PC closed, phone shows:", (await ph.textContent(".banner.warn").catch(() => "(no banner)")).replace(/\s+/g, " ").slice(0, 90));
  const pc2 = await pcCtx.newPage(); pc2.on("pageerror", (e) => console.log("PC2 PAGEERROR", e.message));
  await pc2.goto(URL);
  await until(async () => (await vids(ph)).some((v) => /otter/i.test(v.title) && v.status === "done"), 180000, "PC picks up after reopening");
  console.log("   PC reopened and made it:", (await vids(ph)).find((v) => /otter/i.test(v.title)).worker);
  const total = (await vids(ph)).length, pcTotal = (await vids(pc2)).length;
  console.log("7. both devices agree:", total, "videos on phone,", pcTotal, "on PC");
  await b.close();
})().catch((e) => { console.log("FAIL", e.message.slice(0, 400)); process.exit(1); });
