// ---------------------------------------------------------------- starter formats


/** First entry is the default. "Blank" has no genre: the request decides everything. */
const STARTER_FORMATS = [
  {
    key: "blank",
    name: "Blank",
    emoji: "📝",
    description: "No preset style. The AI follows whatever you ask for.",
    hookStyle: "Open with the most interesting line for this topic. No intro.",
    structure: "Whatever suits the request: hook, build, payoff.",
    visualStyle: "Clean, cinematic, vertical shots that match the topic",
    voiceStyle: "natural, clear, engaging",
    captionStyle: "bold-yellow",
    musicStyle: "chill-pad",
    lengthSec: 40,
  },
  {
    key: "did-you-know",
    name: "Did You Know",
    emoji: "🧠",
    description: "Surprising facts explained fast.",
    hookStyle: "Lead with the most surprising fact as a direct statement or question.",
    structure: "Surprising claim, quick explanation, 2-3 supporting details, a final fact that tops the first.",
    visualStyle: "Bright, crisp close-ups and real-world shots of the subject, documentary look",
    voiceStyle: "curious, upbeat, fast-paced explainer",
    captionStyle: "bold-yellow",
    musicStyle: "upbeat-pulse",
    lengthSec: 35,
  },
  {
    key: "top-5",
    name: "Top 5 List",
    emoji: "🔢",
    description: "Countdown from 5 to 1. Best one last.",
    hookStyle: "Promise the payoff: tell them number one will surprise them.",
    structure: "Countdown 5 to 1, one punchy line of why for each, best item last, quick call to follow.",
    visualStyle: "Bold, colorful hero shots of each item, clean backgrounds",
    voiceStyle: "energetic, confident host",
    captionStyle: "bold-yellow",
    musicStyle: "upbeat-pulse",
    lengthSec: 45,
  },
  {
    key: "storytime",
    name: "Storytime",
    emoji: "📖",
    description: "First-person story with a twist.",
    hookStyle: "Start in the middle of the most dramatic moment.",
    structure: "Cold open, rewind to setup, rising tension, twist, short reflection or punchline.",
    visualStyle: "Cinematic everyday scenes, warm natural light, candid phone-photo feel",
    voiceStyle: "conversational, personal, expressive",
    captionStyle: "clean-white",
    musicStyle: "chill-pad",
    lengthSec: 50,
  },
  {
    key: "motivation",
    name: "Motivation",
    emoji: "🔥",
    description: "Short, punchy mindset content.",
    hookStyle: "Open with a hard truth the viewer needs to hear.",
    structure: "Hard truth, why most people get it wrong, one clear shift, a strong closing line.",
    visualStyle: "Sunrise, city skylines, athletes training, dramatic contrast lighting",
    voiceStyle: "deep, calm, intense",
    captionStyle: "clean-white",
    musicStyle: "tense-pulse",
    lengthSec: 30,
  },
  {
    key: "product-spotlight",
    name: "Product Spotlight",
    emoji: "🛍",
    description: "Show off a product or idea and why it's worth it.",
    hookStyle: "Open with the problem the product solves.",
    structure: "Problem, product reveal, top 3 benefits, who it's for, clear call to action.",
    visualStyle: "Clean product shots, lifestyle scenes, soft studio lighting",
    voiceStyle: "friendly, persuasive, honest",
    captionStyle: "bold-yellow",
    musicStyle: "upbeat-pulse",
    lengthSec: 30,
  },
  {
    key: "scary-story",
    name: "Scary Story",
    emoji: "👻",
    description: "Creepy narration with a twist ending.",
    hookStyle: "Open with an unsettling rule or a moment where something is wrong.",
    structure: "Unsettling hook, normal setup, first wrong thing, escalation, twist that loops to the start.",
    visualStyle: "Dark hallways, night streets, grainy film look, cold light",
    voiceStyle: "low, slow, hushed",
    captionStyle: "red-highlight",
    musicStyle: "dark-drone",
    lengthSec: 45,
  },
];

// ---------------------------------------------------------------- auto style + count
// Pure helper (safe for client + server): pick a format from the request text.
const ALIASES = {
  "did you know": ["did you know", "fact", "facts", "trivia", "explainer"],
  "top 5 list": ["top 5", "top five", "top 10", "top ten", "list", "ranking", "countdown"],
  storytime: ["storytime", "story time", "my story", "true story"],
  motivation: ["motivation", "motivational", "mindset", "discipline", "inspire"],
  "product spotlight": ["product", "review", "ad ", "ads", "promo", "unboxing"],
  "scary story": ["scary", "horror", "creepy", "creepypasta", "ghost", "haunted", "urban legend", "napolitan"],
};

function detectFormat(request, formats) {
  const r = " " + request.toLowerCase().replace(/[-_]/g, " ") + " ";
  let best;
  for (const f of formats) {
    const name = f.name.toLowerCase();
    const words = [name, ...(ALIASES[name] || [])];
    const score = Math.max(0, ...words.map((w) => (r.includes(w) ? w.length : 0)));
    if (score > (best?.score || 0)) best = { f, score };
  }
  return best?.f || formats.find((f) => f.isDefault) || formats[0];
}

/** "Make 10 ..." / "3 fact shorts" -> number of videos (1-50). */
function parseCount(request) {
  const lead = request.match(/^\s*(?:please\s+)?(?:make|create|generate|give me|write|do)\s+(?:me\s+)?(\d{1,2})\b/i);
  const noun = request.match(
    /\b(\d{1,2})\s+(?:[\w'/-]+\s+){0,5}?(videos?|shorts?|reels?|tiktoks?|clips?|stories|story|episodes?|parts?|files?|entries|posts?|scripts?|tales?|legends?)\b/i,
  );
  const n = Number(lead?.[1] || noun?.[1] || 1);
  return Math.min(50, Math.max(1, n));
}

// ---------------------------------------------------------------- prompts (short + structured)

// Keep prompts short and structured. Only send what the step needs.

// ---------------------------------------------------------------- languages
const LANGUAGES = [
  ["English", "English"], ["Korean", "한국어"], ["Japanese", "日本語"], ["Chinese", "中文"], ["Spanish", "Español"],
  ["Portuguese", "Português"], ["French", "Français"], ["German", "Deutsch"], ["Italian", "Italiano"], ["Hindi", "हिन्दी"],
  ["Indonesian", "Bahasa Indonesia"], ["Vietnamese", "Tiếng Việt"], ["Thai", "ไทย"], ["Filipino", "Filipino"],
  ["Arabic", "العربية"], ["Russian", "Русский"], ["Turkish", "Türkçe"],
];
/** Languages written without spaces are measured (and captioned) by characters. */
const CHAR_RATE = { Chinese: 4.5, Japanese: 7, Thai: 10 }; // spoken characters per second
const WORD_RATE = { Korean: 2.0, German: 2.2, Russian: 2.2, Arabic: 2.2, Hindi: 2.4, Spanish: 2.8, Italian: 2.7, French: 2.7, Portuguese: 2.7 };
const byChars = (lang) => lang in CHAR_RATE;
const unitName = (lang) => (byChars(lang) ? "characters" : "words");
function countUnits(text, lang) {
  if (byChars(lang)) return text.replace(/[\s\p{P}\p{S}]/gu, "").length;
  return text.split(/\s+/).filter(Boolean).length;
}
const WORDS_PER_SEC = 2.5;
const targetWords = (sec, lang = "English") => Math.round(sec * (CHAR_RATE[lang] || WORD_RATE[lang] || WORDS_PER_SEC));
const targetLines = (sec) => Math.max(5, Math.min(14, Math.round(sec / 3.5)));

// ---------------------------------------------------------------- reference videos
/** Short text block telling the AI what the user wants to copy (it can't watch the videos). */
function refsText(refs) {
  if (!refs || (!refs.links?.length && !refs.note)) return "";
  const info = refs.info || [];
  const lines = (refs.links || []).map((u, i) => {
    const x = info[i] || {};
    return `- ${x.title ? `"${x.title.slice(0, 120)}"` : u}${x.author ? ` by ${x.author}` : ""}`;
  });
  return `Reference videos to match (you can't watch them; go by the titles and the note):\n${lines.join("\n")}${refs.note ? `\nWhat to copy from them: ${refs.note.slice(0, 300)}` : ""}`;
}

function ideasPrompt(request, format, count, language = "English", refs) {
  return {
    system: "You plan short-form video series. Reply with JSON only.",
    prompt: `Request: ${request.slice(0, 400)}
Format: ${format.name}: ${format.description}
${refsText(refs)}
Give ${count} distinct video ideas. Each needs a different angle (place, object, rule, character, time). Write the titles and angles in ${language}.
JSON: {"ideas":[{"title":"max 8 words","angle":"one sentence"}]}`,
    maxTokens: 120 + count * 60,
  };
}

function scriptSystem(format, language) {
  return `You write viral ${format.name} narration scripts for TikTok, Reels and Shorts.
Rules: line 1 is the hook and must grab in 2 seconds. No intro, no greeting, no "today". Every line adds something new and keeps momentum. End with a payoff: a twist, punchline, takeaway or a line that loops back to the start. Spoken words only, no stage directions or emojis. Write EVERYTHING (title, lines, caption, hashtags) in ${language}, natural and native-sounding, not translated.`;
}

function scriptSpec(format, lengthSec, language = "English") {
  return `Hook style: ${format.hookStyle}
Structure: ${format.structure}
Narrator: ${format.voiceStyle}
Length: ${lengthSec}s = about ${targetWords(lengthSec, language)} ${unitName(language)} in ${targetLines(lengthSec)} lines (one beat per line, short lines).
JSON: {"title":"max 8 words","lines":["..."],"caption":"one-sentence social caption","hashtags":["#tag"]}`;
}

function scriptPrompt(o) {
  return {
    system: scriptSystem(o.format, o.language),
    prompt: `Idea: ${o.idea}
Series: ${o.request.slice(0, 300)}
${refsText(o.refs)}
${scriptSpec(o.format, o.lengthSec, o.language)}`,
    maxTokens: 900,
  };
}

function rewritePrompt(o) {
  return {
    system: scriptSystem(o.format, o.language),
    prompt: `Rewrite this draft and fix the issues. Keep what works.
Draft:
${o.script.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}
Issues: ${o.issues.join("; ")}
${scriptSpec(o.format, o.lengthSec, o.language)}`,
    maxTokens: 900,
  };
}

function checkPrompt(script, lengthSec, language = "English") {
  return {
    system: "You are a strict short-form video script editor. Reply with JSON only.",
    prompt: `Target: ${lengthSec}s spoken in ${language}. Write the issues in English.
${script.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}
Score 1-10: hook (grabs in 2s), pacing, escalation (keeps momentum), ending (strong payoff). List concrete fixes. pass=true only if every score >= 7.
JSON: {"hook":0,"pacing":0,"escalation":0,"ending":0,"issues":["..."],"pass":true}`,
    maxTokens: 300,
  };
}

function scenesPrompt(lines, format) {
  return {
    system: "You write image prompts for vertical short-form videos. Reply with JSON only.",
    prompt: `Visual style: ${format.visualStyle}
For each numbered line write one image prompt (max 30 words: concrete subject, setting, lighting; same style throughout; no text in image; no two alike) and 2-4 stock photo search keywords. Write prompts and keywords in English, whatever language the lines are in.
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}
JSON: {"scenes":[{"visual":"...","search":"..."}]} with exactly ${lines.length} items.`,
    maxTokens: 120 + lines.length * 80,
  };
}

// ---------------------------------------------------------------- offline practice writer (no AI)

/**
 * Offline writer: template-based, no API. Lets the whole pipeline run without keys.
 * Quality is basic on purpose; the UI labels anything it makes as "offline".
 */

function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function subjectOf(request) {
  const m = request.match(/\babout\s+(.+?)[.!?]*$/i);
  if (m) return m[1].replace(/^(an?|the)\s+/i, "").trim();
  return request.replace(/^(make|create|generate)\s+\d*\s*/i, "").replace(/[.!?]+$/, "").trim() || "this place";
}

const ANGLES = [
  "the part nobody talks about", "the biggest myth", "a beginner mistake", "the surprising origin",
  "what experts know", "the weirdest example", "the hidden cost", "why it actually works",
  "the one rule", "a real example", "the fastest way", "what changed everything",
  "the secret detail", "the common mistake", "the untold story", "the best-kept secret",
  "the first thing to know", "the big comeback",
];

function family(f) {
  const n = (f.name + " " + f.structure).toLowerCase();
  if (/countdown|top \d|list/.test(n)) return "list";
  if (/fact|did you know/.test(n)) return "facts";
  if (/scary|horror|creepy|unsettling/.test(n)) return "scary";
  if (/storytime|first-person|story/.test(n)) return "story";
  if (/motivation|mindset|hard truth/.test(n)) return "motivation";
  if (/product|call to action/.test(n)) return "product";
  return "generic";
}

const POOLS = {
  generic: {
    hook: ["Here's what nobody tells you about {S}.", "Most people get {S} wrong. Here's {A}."],
    mid: [
      "It starts with something simple that almost everyone overlooks.",
      "Once you notice it, you'll start seeing it everywhere.",
      "The reason behind it is surprisingly practical.",
      "Here's a quick example that makes it click.",
      "And this is exactly where most people give up.",
      "But the ones who stick with it see a huge difference.",
      "The trick is to focus on one small thing first.",
      "That one change makes everything after it easier.",
    ],
    end: ["Now you know more about {S} than most people. Follow for part two.", "Save this so you remember it next time {S} comes up."],
  },
  facts: {
    hook: ["Did you know this about {S}? It sounds fake, but it's true.", "This one fact about {S} changes how you see it."],
    mid: [
      "Scientists only figured this out surprisingly recently.",
      "It all comes down to one simple reason.",
      "And it's not the only strange thing about {S}.",
      "Here's a detail most people have never heard.",
      "It happens far more often than you'd think.",
      "People have been getting this wrong for years.",
      "Once you know why, it actually makes perfect sense.",
    ],
    end: ["But the strangest part about {S}? Follow and I'll tell you next time.", "Tell someone this today and watch their reaction."],
  },
  story: {
    hook: ["I still can't believe what happened with {S}.", "This is the story of {A}, and it still gets me."],
    mid: [
      "It was a completely normal day. Nothing seemed off.",
      "Then one small thing caught my attention.",
      "I tried to ignore it, but it kept happening.",
      "So I decided to find out what was going on.",
      "What I found was not what I expected at all.",
      "Everyone around me had known the whole time.",
      "And nobody had said a word.",
    ],
    end: ["I see {S} completely differently now.", "Part two is even crazier. Follow so you don't miss it."],
  },
  motivation: {
    hook: ["Nobody is coming to save you. Not with {S}, not with anything.", "If {S} feels hard right now, listen to this."],
    mid: [
      "Most people wait until they feel ready. They never do.",
      "Discipline beats motivation every single time.",
      "You don't need a perfect plan. You need a first step.",
      "The people you admire were once exactly where you are.",
      "Every day you show up, you get a little harder to stop.",
      "Stop counting the days. Make the days count.",
    ],
    end: ["Start today. Your future self is watching.", "Save this for the day you want to quit."],
  },
  product: {
    hook: ["Tired of struggling with {S}? This changes everything.", "If you care about {S}, you need to see this."],
    mid: [
      "Here's the problem. Most options are overpriced and overcomplicated.",
      "This one is different.",
      "First, it's ridiculously easy to use.",
      "Second, it saves you time every single day.",
      "Third, it's built to last.",
      "It's perfect if you want results without the hassle.",
    ],
    end: ["Check the link in my bio and see for yourself.", "Comment if you want the full breakdown."],
  },
  scary: {
    hook: ["I knew something was wrong with {S} the night I found {A}.", "There's a rule about {S}. Never break it."],
    mid: [
      "It started small. A door I'd locked was open.",
      "Nobody had lived upstairs for years. I heard footsteps every night.",
      "At exactly three thirty three, the footsteps stopped.",
      "Then something started breathing on the other side of my door.",
      "Every photo from that night had a figure in the background.",
      "Closer in every one.",
      "I don't remember opening the door. But it was unlocked from the inside.",
    ],
    end: ["I moved out last week. Last night, I heard footsteps again.", "I'm telling you so you'll recognize it. It's coming to you next."],
  },
};

const LIST_ITEMS = [
  "the hidden gem. It's better than it has any right to be.",
  "the classic. It still holds up after all these years.",
  "the underrated one. Almost nobody talks about it.",
  "the one that went viral, and honestly, for good reason.",
  "the one experts swear by.",
  "the surprise pick. You won't see it coming.",
];
const NUM = ["One", "Two", "Three", "Four", "Five"];

function writeScript(input) {
  const r = rng(input.idea + input.format.name);
  const S = subjectOf(input.request || input.idea);
  const pick = ANGLES[Math.floor(r() * ANGLES.length)];
  const A = input.angle && input.angle.length <= 40 && !/^make\b/i.test(input.angle) ? input.angle : pick;
  const fam = family(input.format);
  const fill = (x) => x.replaceAll("{S}", S).replaceAll("{A}", A);
  const target = Math.round(input.lengthSec * 2.5);
  let lines;
  if (fam === "list") {
    const items = shuffle(LIST_ITEMS, r).slice(0, 5);
    lines = [
      fill("Here are the top five {S} you need to know. Number one will surprise you."),
      ...items.map((it, i) => `Number ${NUM[4 - i].toLowerCase()}: ${it}`),
      "Which one would you pick? Tell me in the comments.",
    ];
  } else {
    const pool = POOLS[fam];
    const nMid = Math.max(3, Math.min(pool.mid.length, Math.round(target / 12) - 2));
    lines = [
      fill(pool.hook[Math.floor(r() * pool.hook.length)]),
      ...shuffle(pool.mid, r).slice(0, nMid).map(fill),
      fill(pool.end[Math.floor(r() * pool.end.length)]),
    ];
  }
  const title = `${cap(S)}: ${cap(A)}`;
  const tag = (x) => "#" + x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    title,
    hook: lines[0],
    lines,
    caption: `${title}. What do you think?`,
    hashtags: ["#fyp", ...(fam === "generic" ? [] : [tag(input.format.name)]), tag(S.split(" ").slice(-1)[0] || "shorts")].filter((h) => h.length > 1),
  };
}
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const STOP = new Set("the a an of to in on at and or is are was it if you your do not with for from that this be by as".split(" "));
function keywords(text, style) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 3).join(" ") || style.split(",")[0];
}


// ---------------------------------------------------------------- style from a free-text content type
const CAPTION_OPTIONS = ["bold-yellow", "clean-white", "red-highlight", "glitch"];
const MUSIC_OPTIONS = ["chill-pad", "upbeat-pulse", "tense-pulse", "dark-drone", "eerie-tone", "none"];
function designPrompt(contentType, request, refs) {
  return {
    system: "You design the style for a series of short-form videos (TikTok, Reels, Shorts). Reply with JSON only.",
    prompt: `Content type: ${contentType || "(not given: work it out from the request)"}
Request: ${request.slice(0, 300)}
${refsText(refs)}
Design a style that fits. captionStyle is one of: ${CAPTION_OPTIONS.join(", ")}. musicStyle is one of: ${MUSIC_OPTIONS.join(", ")}. lengthSec between 20 and 60.
JSON: {"name":"2-4 words","emoji":"one emoji","description":"one line","hookStyle":"how line 1 grabs","structure":"beat by beat","visualStyle":"what the pictures look like","voiceStyle":"how the narrator sounds","captionStyle":"bold-yellow","musicStyle":"chill-pad","lengthSec":40}`,
    maxTokens: 500,
  };
}
/** Without AI: pick the closest built-in style and name it after what was typed. */
function fallbackStyle(contentType, request) {
  const base = detectFormat(`${contentType || ""} ${request}`, STARTER_FORMATS.map((f, i) => ({ ...f, id: f.key, isDefault: i === 0 })));
  const { key, id, isDefault, ...rest } = base;
  const name = (contentType || "").trim();
  return name ? { ...rest, name: name.slice(0, 40), emoji: rest.emoji, description: name } : rest;
}
function cleanStyle(j, fallback) {
  const s = { ...fallback };
  for (const k of ["name", "emoji", "description", "hookStyle", "structure", "visualStyle", "voiceStyle"]) if (j?.[k]) s[k] = String(j[k]).slice(0, 400);
  if (CAPTION_OPTIONS.includes(j?.captionStyle)) s.captionStyle = j.captionStyle;
  if (MUSIC_OPTIONS.includes(j?.musicStyle)) s.musicStyle = j.musicStyle;
  if (Number(j?.lengthSec)) s.lengthSec = clamp(Math.round(Number(j.lengthSec)), 20, 60);
  s.name = s.name.slice(0, 40);
  s.emoji = [...String(s.emoji || "🎬")].slice(0, 2).join("");
  return s;
}
