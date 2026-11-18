const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
// Platforms + Sora: TikTok + Douyin picked, Auto length, Sora on every scene.
// Mocks Anthropic (writer) and OpenAI /v1/videos (Sora) at the network level.
const { chromium } = require("playwright"); const fs = require("fs");
const URL = APP;
const CLIP = fs.readFileSync(FIX("cuts.webm"));
const SHORT = ["凌晨三点，电梯停在了十三楼。", "可这栋楼根本没有十三楼。", "门开了，外面一片漆黑。", "有人轻轻说：你终于来了。", "第二天，监控里只有我一个人。"];
const LONG = Array.from({ length: 11 }, (_, i) => `第${i + 1}个细节：老住户都知道，电梯会在深夜自己停下，走廊冷得出奇。`);
const prompts = [];
let jobs = 0, polls = 0, sizes = [], secs = [];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem("cf-init")) {
      localStorage.setItem("cf-init", "1");
      localStorage.setItem("cf-keys", JSON.stringify({ ANTHROPIC_API_KEY: "sk-ant-test-123456", OPENAI_API_KEY: "sk-test-123456" }));
      localStorage.setItem("cf-roles", JSON.stringify({ writer: "anthropic", voice: "no-voice", visuals: "sora" }));
      localStorage.setItem("cf-sora", JSON.stringify({ model: "sora-2", mode: "all" }));
    }
  });
  await ctx.route("https://api.anthropic.com/**", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const t = (body.system || "") + "\n" + body.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text || "").join(""))).join("\n");
    prompts.push(t);
    let out;
    if (body.max_tokens === 1) out = "ok";
    else if (/Design a style/.test(t)) out = JSON.stringify({ name: "都市怪谈", emoji: "🛗", description: "Short eerie stories", hookStyle: "impossible fact", structure: "setup, wrongness, twist", visualStyle: "dark hallway, cold light", voiceStyle: "low calm", captionStyle: "bold-yellow", musicStyle: "dark-drone", lengthSec: 30 });
    else if (/Score 1-10/.test(t)) out = JSON.stringify({ hook: 8, pacing: 8, escalation: 8, ending: 8, rules: 9, issues: [], pass: true });
    else if (/image prompt/.test(t)) { const n = Number((t.match(/exactly (\d+) items/) || [])[1] || 5); out = JSON.stringify({ scenes: Array.from({ length: n }, (_, i) => ({ visual: "dark elevator hallway " + i, search: "elevator" })) }); }
    else if (/must run over/.test(t)) out = JSON.stringify({ title: "十三楼", lines: LONG, caption: "这栋楼没有十三楼", hashtags: ["#怪谈"], posts: { tiktok: { caption: "There is no 13th floor", hashtags: ["#scary", "#story", "#creepy", "#horror", "#fyp", "#extra1"] }, douyin: { title: "这栋楼根本没有十三楼，可电梯停在了那里，这是一个超过五十五个字的非常非常长的标题用来测试截断功能是否正常", caption: "凌晨三点", hashtags: ["#怪谈", "#悬疑"] } } });
    else out = JSON.stringify({ title: "十三楼", lines: SHORT, caption: "这栋楼没有十三楼", hashtags: ["#怪谈"] });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: out }], usage: { input_tokens: 100, output_tokens: 100 } }) });
  });
  await ctx.route("https://api.openai.com/v1/videos**", async (route) => {
    const u = route.request().url(), m = route.request().method();
    const H = { "access-control-allow-origin": "*" };
    if (m === "POST") {
      const body = route.request().postDataBuffer().toString("latin1");
      sizes.push((body.match(/name="size"\r\n\r\n([^\r]+)/) || [])[1]);
      secs.push((body.match(/name="seconds"\r\n\r\n([^\r]+)/) || [])[1]);
      jobs++;
      return route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify({ id: "video_" + jobs, status: jobs === 1 ? "queued" : "completed", model: "sora-2" }) });
    }
    if (/\/content/.test(u)) return route.fulfill({ status: 200, contentType: "video/webm", headers: H, body: CLIP });
    polls++;
    return route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify({ id: u.split("/").pop(), status: "completed" }) });
  });
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 200)));
  await p.goto(URL); await p.waitForSelector("text=GENERATE VIDEOS"); await p.waitForTimeout(600);
  // Connect page shows Sora options
  await p.click("nav .link:has-text('Connect')"); await p.waitForTimeout(400);
  console.log("Sora option shown:", await p.isVisible("text=Sora AI video"), "| cost line:", (await p.textContent("text=/Roughly/")).slice(0, 80));
  await p.screenshot({ path: OUT("p0-connect.png"), fullPage: true });
  await p.click("nav .link:has-text('Make')"); await p.waitForTimeout(300);
  await p.fill("textarea >> nth=0", "Make 1 creepy elevator story");
  await p.click("button.chip:has-text('TikTok')");
  await p.click("button.chip:has-text('Douyin')");
  await p.click("button.chip:has-text('30 sec')");
  console.log("raised note:", await p.isVisible("text=/made at least 70 seconds/"));
  await p.click("text=Make them in Chinese");
  console.log("language now:", await p.inputValue("select"), "| AI label note:", await p.isVisible("text=/AI生成/"));
  await p.screenshot({ path: OUT("p1-home.png"), fullPage: true });
  const t0 = Date.now();
  await p.click("text=GENERATE VIDEOS");
  await p.waitForSelector("text=All done", { timeout: 400000 });
  console.log("done in", Math.round((Date.now() - t0) / 1000), "s");
  const all = await p.evaluate(async () => (await window.__cf.db.all("videos")).map((v) => ({ platform: v.platform, secs: v.steps.final_check.output.seconds, rep: v.steps.final_check.output.platforms, posts: Object.keys(v.steps.script.output.posts || {}) })));
  for (const x of all) console.log("VIDEO", x.platform, x.secs.toFixed(1) + "s", JSON.stringify(Object.fromEntries(Object.entries(x.rep).map(([k, r]) => [k, r.ok]))), "posts:", x.posts.join());
  const proj = await p.evaluate(async () => (await window.__cf.db.all("projects"))[0]);
  const v = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0]);
  console.log("project:", proj.platforms.join(","), "lengthSec", proj.lengthSec, "minSec", proj.minSec, "aiLabel", proj.aiLabel, "cost $" + proj.cost.toFixed(2));
  const sp = prompts.find((x) => /Hook style/.test(x));
  console.log("script prompt: rules", /must follow every rule/.test(sp), "| 1-min rule", /at least 65 seconds/.test(sp), "| china rule", /absolute words/.test(sp), "| posts spec", /"posts":\{"tiktok"/.test(sp));
  console.log("check prompt has rules score:", /"rules":0/.test(prompts.find((x) => /Score 1-10/.test(x))));
  console.log("lengthen rewrite happened:", prompts.some((x) => /must run over 64s/.test(x)), "| lines now", v.steps.script.output.lines.length, "| scenes", v.steps.scenes.output.length);
  console.log("narration secs:", v.steps.voice.output.duration.toFixed(1), "| final secs:", v.steps.final_check.output.seconds.toFixed(1));
  console.log("sora jobs:", jobs, "polls:", polls, "sizes:", [...new Set(sizes)].join(), "clip seconds:", [...new Set(secs)].join(), "| clips used:", v.steps.visuals.output.clips);
  const posts = v.steps.script.output.posts;
  console.log("posts: tiktok tags", posts.tiktok.hashtags.length, "(max 5) | douyin title chars", [...posts.douyin.title].length, "(max 55)");
  console.log("report:", JSON.stringify(Object.fromEntries(Object.entries(v.steps.final_check.output.platforms).map(([k, r]) => [k, r.ok]))));
  await p.screenshot({ path: OUT("p2-project.png"), fullPage: true });
  await p.click(".badge.plat >> nth=1"); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT("p3-badge.png") });
  console.log("douyin modal: copy btn", await p.isVisible("text=/Copy Douyin post text/"), "| AI step", await p.isVisible("text=/内容由AI生成/"));
  await p.keyboard.press("Escape");
  const b64 = await p.evaluate(async (k) => { const blob = await window.__cf.blobs.get(k); return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); }); }, v.steps.assemble.output.key);
  fs.writeFileSync(OUT("plat.mp4"), Buffer.from(b64, "base64"));
  console.log("saved", fs.statSync(OUT("plat.mp4")).size, "bytes");
  await b.close();
})();
