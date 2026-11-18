const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
const { chromium } = require("playwright"); const fs = require("fs");
const URL = APP;
const MOCK = () => {
  window.__prompts = [];
  const KO = ["새벽 5시, 알람이 울린다.", "다시 누울 핑계는 천 가지가 있다.", "하지만 오늘의 너는 어제와 다르다.", "이불을 걷어차고 일어나라.", "미래의 네가 고마워할 거다."];
  const JA = ["朝五時、アラームが鳴る。", "布団に戻る言い訳はいくらでもある。", "でも今日の君は昨日とは違う。", "布団を蹴って起き上がれ。", "未来の自分がきっと感謝する。"];
  const sample = async (input, opts = {}) => {
    const t = typeof input === "string" ? input : input.map((x) => x.content).join("\n");
    window.__prompts.push(t);
    const L = /in Japanese/.test(t) ? JA : KO;
    if (/Design a style/.test(t)) return { text: JSON.stringify({ name: "기상 동기부여", emoji: "⏰", description: "Morning motivation", hookStyle: "Hard truth", structure: "truth, push", visualStyle: "sunrise, city", voiceStyle: "calm, intense", captionStyle: "bold-yellow", musicStyle: "chill-pad", lengthSec: 20 }) };
    if (/video ideas/.test(t)) return { text: JSON.stringify({ ideas: [{ title: "5시 기상", angle: "알람" }] }) };
    if (/Score 1-10/.test(t)) return { text: JSON.stringify({ hook: 8, pacing: 8, escalation: 8, ending: 8, issues: [], pass: true }) };
    if (/image prompt/.test(t)) return { text: JSON.stringify({ scenes: L.map((_, i) => ({ visual: "sunrise city " + i, search: "sunrise" })) }) };
    return { text: JSON.stringify({ title: L[0], lines: L, caption: L[4], hashtags: ["#동기부여"] }) };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
  window.claude = { use: async (n) => (n === "sample" ? sample : n === "downloads" ? { save: async () => ({ status: "saved" }) } : null) };
};
async function make(p, { text, lang, links, note, length }) {
  await p.click("nav .link:has-text('Make')"); await p.waitForTimeout(300);
  await p.fill("textarea >> nth=0", text);
  await p.click(`button.chip:has-text('${length} sec')`);
  await p.selectOption("select", lang);
  if (links) { await p.fill(".refs textarea", links); await p.fill(".refs input", note); }
  await p.click("text=GENERATE VIDEOS");
  await p.waitForSelector("text=All done", { timeout: 200000 });
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(URL); await p.waitForSelector("text=GENERATE VIDEOS"); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT("l0-home.png"), fullPage: true });
  await make(p, { text: "Make 1 short about waking up early", lang: "Korean", links: "https://www.tiktok.com/@coach/video/123\nhttps://youtube.com/shorts/abc", note: "the calm but intense tone", length: 15 });
  await p.screenshot({ path: OUT("l1-project.png"), fullPage: true });
  const pr = await p.evaluate(() => window.__prompts);
  const script = pr.find((x) => /Hook style/.test(x));
  console.log("Korean script prompt has language:", /in Korean/.test(script), "| refs:", /Reference videos to match/.test(script) && /calm but intense/.test(script));
  console.log("   length unit:", (script.match(/about \d+ (words|characters)/) || [])[0]);
  const v = await p.evaluate(async () => (await window.__cf.db.all("videos"))[0]);
  console.log("   script calls:", pr.filter((x) => /Hook style/.test(x)).length, "(1 = no needless rewrite) | caption pieces:", v.steps.captions.output.words.slice(0, 4).map((w) => w.word).join(" | "));
  await make(p, { text: "Make 1 short about waking up early", lang: "Japanese", length: 15 });
  const v2 = await p.evaluate(async () => (await window.__cf.db.all("videos")).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]);
  console.log("Japanese caption pieces:", v2.steps.captions.output.words.slice(0, 5).map((w) => w.word + (w.glue ? "+" : " ")).join(""), "| script calls:", (await p.evaluate(() => window.__prompts)).filter((x) => /Hook style/.test(x) && /Japanese/.test(x)).length);
  for (const [vv, name] of [[v, "ko"], [v2, "ja"]]) {
    const bytes = await p.evaluate(async (k) => Array.from(new Uint8Array(await (await window.__cf.blobs.get(k)).arrayBuffer())), vv.steps.assemble.output.key);
    fs.writeFileSync(OUT(`${name}.mp4`), Buffer.from(bytes));
  }
  await b.close();
})();
