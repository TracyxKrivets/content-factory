// ---------------------------------------------------------------- platforms + monetization rules
// Rules as researched in Nov 2026. Platforms change these often; the app shows "check" notes
// and never promises approval (most programs also need follower/view counts a video can't change).
const RULES_CHECKED = "Nov 2026";
const CHINA_BASE = [
  "AI-generated content must be labelled (China's AI labelling rules, in force since 1 Sep 2025): a visible 'AI生成' mark on the video plus the platform's AI declaration when posting",
  "No political, military or sensitive historical topics; no vulgar, violent or superstitious content",
  "No absolute advertising words (最, 第一, 国家级, 100%) and no exaggerated health, money or product claims (Advertising Law)",
  "No watermarks or logos from other apps; original content only",
];
const PLATFORMS = [
  {
    id: "tiktok", name: "TikTok", emoji: "🎵", region: "global", payMinSec: 61, maxSec: 600, tags: [3, 5], titleMax: 0,
    program: "Creator Rewards Program",
    needs: "18+, 10,000 followers, 100,000 views in the last 30 days, a personal account in an eligible country. Each video must be over 1 minute and reach 1,000 For You views.",
    rules: [
      "Only videos OVER 1 minute earn Creator Rewards",
      "Original content: no re-uploads, no clips from TV/films/other creators",
      "Photo mode and slideshows don't earn; it must be a real video",
      "Realistic AI scenes must carry TikTok's AI-generated label",
    ],
    ai: "Before posting: More options → turn on “AI-generated content”.",
    safe: { right: 150, bottom: 430 },
  },
  {
    id: "youtube", name: "YouTube Shorts", emoji: "▶️", region: "global", payMinSec: 0, maxSec: 180, tags: [3, 3], titleMax: 100,
    program: "YouTube Partner Program (Shorts ad revenue)",
    needs: "1,000 subscribers + 10 million Shorts views in 90 days (or 4,000 watch hours). Fan-funding tier from 500 subscribers + 3 uploads in 90 days.",
    rules: [
      "'Inauthentic content' policy: no mass-produced, repetitive or template videos; every video needs real variety and value",
      "AI script + AI voice over stock pictures with nothing original is the top rejection reason; add a real angle, opinion or story",
      "Shorts can be up to 3 minutes",
      "Original audio earns a bigger share than licensed songs (this app makes its own music)",
    ],
    ai: "In YouTube Studio → Details → tick “Altered or synthetic content” when realistic AI scenes or voices are used.",
    safe: { right: 140, bottom: 400 },
  },
  {
    id: "instagram", name: "Instagram Reels", emoji: "📸", region: "global", payMinSec: 0, maxSec: 180, tags: [3, 5], titleMax: 0,
    program: "Reels bonuses (invite only) + brand deals",
    needs: "Professional (Creator/Business) account, 18+, eligible country, Partner Monetization Policies. Per-view bonuses are invite-only.",
    rules: [
      "Original content: reposts and videos with other apps' watermarks get shown to fewer people",
      "No unlicensed music, no misleading or engagement-bait captions",
      "Realistic AI video should carry Meta's AI label",
    ],
    ai: "When posting: Advanced settings → turn on “AI label”.",
    safe: { right: 130, bottom: 380 },
  },
  {
    id: "facebook", name: "Facebook Reels", emoji: "📘", region: "global", payMinSec: 0, maxSec: 180, tags: [2, 4], titleMax: 0,
    program: "Facebook Content Monetization",
    needs: "Professional mode on, Partner Monetization Policies, eligible country. Your eligibility checklist is in the Professional dashboard.",
    rules: [
      "Original content only: re-uploads from other pages earn nothing and can lose eligibility",
      "No engagement bait (\"share if you agree\"), no misleading claims",
      "Realistic AI video should carry Meta's AI label",
    ],
    ai: "When posting: turn on the “AI info” label for realistic AI scenes.",
    safe: { right: 130, bottom: 420 },
  },
  {
    id: "snapchat", name: "Snapchat Spotlight", emoji: "👻", region: "global", payMinSec: 60, maxSec: 300, tags: [1, 3], titleMax: 0,
    program: "Snapchat Unified Monetization Program",
    needs: "Snap Star status, 50,000 followers, 25+ posts a month, and 100 hours of Spotlight view time in 28 days. Videos must be at least 1 minute to share revenue.",
    rules: ["Spotlight videos must be at least 1 minute to earn", "Original content; no watermarks from other apps", "Post often: 25+ times a month is a requirement"],
    ai: "Add an AI note in the caption for realistic AI scenes.",
    safe: { right: 120, bottom: 360 },
  },
  {
    id: "douyin", name: "Douyin 抖音", emoji: "🎶", region: "china", payMinSec: 0, maxSec: 900, tags: [3, 5], titleMax: 55,
    program: "Xingtu brand deals, product links, creator programs",
    needs: "Real-name verified account; programs and follower thresholds are listed in 创作者服务中心. Paid videos need 100,000+ followers.",
    rules: [...CHINA_BASE, "Undeclared AI content can have earnings suspended and followers reduced"],
    ai: "When posting: 高级设置 → 作者声明 → “内容由AI生成”.",
    safe: { right: 150, bottom: 430 },
  },
  {
    id: "kuaishou", name: "Kuaishou 快手", emoji: "⚡", region: "china", payMinSec: 0, maxSec: 900, tags: [3, 5], titleMax: 50,
    program: "Creator incentives, brand deals (磁力聚星), product links",
    needs: "Real-name verified account; see 创作者中心 for the programs you qualify for.",
    rules: [...CHINA_BASE],
    ai: "When posting: choose the AI-generated content declaration (作者声明 → AI生成).",
    safe: { right: 150, bottom: 420 },
  },
  {
    id: "xiaohongshu", name: "Xiaohongshu 小红书", emoji: "📕", region: "china", payMinSec: 0, maxSec: 900, tags: [3, 8], titleMax: 20,
    program: "Pugongying (蒲公英) brand deals, paid content (invite)",
    needs: "Real-name verified account; brand deals go through 蒲公英 once you qualify.",
    rules: [...CHINA_BASE, "Brand collaborations must be declared through 蒲公英; hidden ads get limited", "Titles are max 20 characters; useful, honest 'notes' tone"],
    ai: "When posting: 高级选项 → 内容类型声明 → “AI生成”.",
    safe: { right: 120, bottom: 360 },
  },
  {
    id: "wechat", name: "WeChat Channels 视频号", emoji: "💬", region: "china", payMinSec: 0, maxSec: 1800, tags: [2, 4], titleMax: 16,
    program: "Creator share programs, brand deals (互选), product links",
    needs: "Real-name verified account; see 视频号助手 for the programs you qualify for.",
    rules: [...CHINA_BASE],
    ai: "When posting: 声明 → “该内容由AI生成”.",
    safe: { right: 130, bottom: 400 },
  },
  {
    id: "bilibili", name: "Bilibili 哔哩哔哩", emoji: "📺", region: "china", payMinSec: 0, maxSec: 3600, tags: [5, 10], titleMax: 80,
    program: "创作激励计划 (Creation Incentive)",
    needs: "Apply in 创作中心 → 创作激励 (last published rule: creativity or influence score 55+, credit score 80+).",
    rules: [
      ...CHINA_BASE,
      "Incentive pay: video must be self-made (自制) with NO commercial promotion (no logos, ads or sponsor reads)",
      "Must be published on Bilibili first, not later than on other platforms",
      "Viewers prefer depth: explain more, rush less",
    ],
    ai: "When posting: 创作声明 → “作者声明：使用AI合成技术”.",
    safe: { right: 130, bottom: 380 },
  },
];
const platformById = (id) => PLATFORMS.find((p) => p.id === id);
const pickPlatforms = (ids) => (ids || []).map(platformById).filter(Boolean);
const hasChina = (ids) => pickPlatforms(ids).some((p) => p.region === "china");
/** Shortest length (seconds) a video must reach to earn on the chosen platforms (0 = none). */
const payMinSec = (ids) => Math.max(0, ...pickPlatforms(ids).map((p) => p.payMinSec || 0));
/** Length to aim for when the user picked "Auto": clear the pay minimum with room to spare. */
const platformAutoLength = (ids, styleLen) => (payMinSec(ids) ? Math.max(styleLen || 0, payMinSec(ids) + 9) : styleLen);
/** Keep captions clear of the like/comment buttons on every chosen platform. */
function safeZone(ids) {
  const ps = pickPlatforms(ids);
  return { right: Math.max(90, ...ps.map((p) => p.safe.right)), bottom: Math.max(330, ...ps.map((p) => p.safe.bottom)) };
}

/** Rules block for the AI writer. Kept short so it costs few tokens. */
function platformRulesText(ids, lengthSec) {
  const ps = pickPlatforms(ids);
  if (!ps.length) return "";
  const lines = [`This video will be posted on: ${ps.map((p) => p.name).join(", ")}. It must follow every rule so it can earn money there:`];
  lines.push("- Original and transformative: a real angle, story, facts or opinion; never a copy or a generic template; no copyrighted characters, songs, film clips or real people's likeness");
  lines.push("- Advertiser-friendly: no shocking, hateful, sexual, dangerous-stunt or misleading content; no fake claims; no engagement bait");
  const min = payMinSec(ids);
  if (min) lines.push(`- Spoken narration must run at least ${min + 4} seconds (${ps.filter((p) => p.payMinSec).map((p) => p.name).join(" and ")} only pay for videos over 1 minute)${lengthSec && lengthSec < min ? " (the user picked a shorter length, so it won't earn there)" : ""}`);
  if (ids.includes("bilibili")) lines.push("- No brand names, product plugs or sponsor reads (Bilibili incentive pay requires no commercial promotion)");
  if (hasChina(ids)) lines.push("- Chinese platforms: avoid politics, military, sensitive history, superstition and absolute words like 最/第一/100%; no exaggerated health or money claims");
  if (ids.includes("youtube")) lines.push("- Make this video clearly different from the others in the series (YouTube rejects repetitive mass-produced channels)");
  return lines.join("\n");
}
/** JSON fields the writer fills in: post text for each platform. */
function postsSpec(ids) {
  const ps = pickPlatforms(ids);
  if (!ps.length) return "";
  return `Also write the post text for each platform in the same language as the script (titles within the limit, hashtags in that platform's style, no banned words):
"posts":{${ps.map((p) => `"${p.id}":{${p.titleMax ? `"title":"max ${p.titleMax} chars",` : ""}"caption":"...","hashtags":[${p.tags[1]} tags]}`).join(",")}}`;
}
/** Fill in post text for every platform, using the general caption when the AI left one out. */
function normalizePosts(ids, j, base) {
  const out = {};
  for (const p of pickPlatforms(ids)) {
    const x = (j && typeof j === "object" && j[p.id]) || {};
    const tags = (Array.isArray(x.hashtags) && x.hashtags.length ? x.hashtags : base.hashtags || [])
      .map((t) => String(t).trim().replace(/^#?/, "#").replace(/\s+/g, ""))
      .filter((t) => t.length > 1)
      .slice(0, p.tags[1]);
    const title = p.titleMax ? [...String(x.title || base.title || "")].slice(0, p.titleMax).join("") : "";
    out[p.id] = { title, caption: String(x.caption || base.caption || "").slice(0, 2000), hashtags: tags };
  }
  return out;
}
const postText = (post) => [post.title, post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n");

/** Per-platform readiness for a finished video. Warnings don't stop the video; they explain. */
function platformReport(ids, { seconds, aiLabel, sora }) {
  const rep = {};
  for (const p of pickPlatforms(ids)) {
    const notes = [];
    let ok = true;
    if (p.payMinSec && seconds < p.payMinSec) {
      ok = false;
      notes.push(`${Math.round(seconds)}s: under 1 minute, so it won't earn ${p.program}`);
    }
    if (seconds > p.maxSec) {
      ok = false;
      notes.push(`Too long for ${p.name} (max ${p.maxSec}s)`);
    }
    if (p.region === "china" && !aiLabel) {
      ok = false;
      notes.push("Missing the visible AI生成 label Chinese platforms require");
    }
    notes.push(p.ai + (sora ? " (needed: this video has realistic AI clips)" : ""));
    rep[p.id] = { ok, notes };
  }
  return rep;
}
