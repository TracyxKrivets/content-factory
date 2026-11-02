import type { Format, Script } from "../../types";
import type { LlmProvider } from "../types";

/**
 * Offline writer: template-based, no API. Lets the whole pipeline run without keys.
 * Quality is basic on purpose; the UI labels anything it makes as "offline".
 */

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], r: () => number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function subjectOf(request: string) {
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

type Family = "generic" | "facts" | "list" | "story" | "motivation" | "product" | "scary";
function family(f: Format): Family {
  const n = (f.name + " " + f.structure).toLowerCase();
  if (/countdown|top \d|list/.test(n)) return "list";
  if (/fact|did you know/.test(n)) return "facts";
  if (/scary|horror|creepy|unsettling/.test(n)) return "scary";
  if (/storytime|first-person|story/.test(n)) return "story";
  if (/motivation|mindset|hard truth/.test(n)) return "motivation";
  if (/product|call to action/.test(n)) return "product";
  return "generic";
}

const POOLS: Record<Exclude<Family, "list">, { hook: string[]; mid: string[]; end: string[] }> = {
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

function writeScript(input: { idea: string; angle?: string; format: Format; lengthSec: number; request?: string }): Script {
  const r = rng(input.idea + input.format.name);
  const S = subjectOf(input.request || input.idea);
  const pick = ANGLES[Math.floor(r() * ANGLES.length)];
  const A = input.angle && input.angle.length <= 40 && !/^make\b/i.test(input.angle) ? input.angle : pick;
  const fam = family(input.format);
  const fill = (x: string) => x.replaceAll("{S}", S).replaceAll("{A}", A);
  const target = Math.round(input.lengthSec * 2.5);
  let lines: string[];
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
  const tag = (x: string) => "#" + x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    title,
    hook: lines[0],
    lines,
    caption: `${title}. What do you think?`,
    hashtags: ["#fyp", ...(fam === "generic" ? [] : [tag(input.format.name)]), tag(S.split(" ").slice(-1)[0] || "shorts")].filter((h) => h.length > 1),
  };
}
const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const STOP = new Set("the a an of to in on at and or is are was it if you your do not with for from that this be by as".split(" "));
function keywords(text: string, style: string) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 3).join(" ") || style.split(",")[0];
}

export const offlineLlm: LlmProvider = {
  id: "offline-writer",
  label: "Offline writer (templates)",
  capability: "llm",
  offline: true,
  available: () => true,
  async complete(req) {
    const i = req.input || {};
    let out: any;
    switch (req.task) {
      case "ideas": {
        const r = rng(i.request || "x");
        const S = subjectOf(i.request || "");
        out = {
          ideas: shuffle(ANGLES, r)
            .slice(0, i.count || 1)
            .map((a) => ({ title: `${cap(S)}: ${cap(a)}`, angle: a })),
        };
        break;
      }
      case "script":
      case "rewrite":
        out = writeScript(i);
        break;
      case "check":
        out = { hook: 7, pacing: 7, escalation: 7, ending: 7, issues: [], pass: true };
        break;
      case "scenes":
        out = {
          scenes: (i.lines as string[]).map((l) => ({
            visual: `${l} ${i.format?.visualStyle || ""}`.slice(0, 300),
            search: keywords(l, i.format?.visualStyle || "city street"),
          })),
        };
        break;
    }
    return { text: JSON.stringify(out), model: "offline", inputTokens: 0, outputTokens: 0, cost: 0 };
  },
};
