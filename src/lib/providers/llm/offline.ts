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
  "the night shift", "the fourth floor", "the new neighbor", "the elevator", "the maintenance notice",
  "the lost and found", "the 3:33 AM rule", "the knocking", "the basement", "the mail room",
  "the stairwell lights", "the intercom", "the window across the street", "the missing room number",
  "the guest list", "the second staircase", "the quiet hours", "the welcome letter",
];

type Family = "rules" | "notice" | "broadcast" | "file" | "story";
function family(f: Format): Family {
  const n = (f.name + " " + f.structure).toLowerCase();
  if (n.includes("rule")) return "rules";
  if (n.includes("napolitan") || n.includes("notice")) return "notice";
  if (n.includes("analog") || n.includes("broadcast")) return "broadcast";
  if (n.includes("scp") || n.includes("containment")) return "file";
  return "story";
}

const POOLS: Record<Family, { hook: string[]; mid: string[]; end: string[] }> = {
  rules: {
    hook: ["Rule one. If you hear your name called from {A}, do not answer.", "Rule one. Never take {A} after midnight."],
    mid: [
      "Rule two. The {S} has eleven floors. If the panel shows twelve, step out and wait.",
      "Rule three. Staff wear blue lanyards. Nobody here wears red. If you see red, look down.",
      "Rule four. Lights flicker three times before a check. Stand still until they stop.",
      "Rule five. If a coworker asks you which rule you're on, say rule two. Always rule two.",
      "Rule six. The cameras show one more person than is actually in the building. That's normal.",
      "Rule seven. Forget rule four. Rule four was added by someone who no longer works here.",
      "Rule eight. If you smell smoke and there's no alarm, there is no fire. Go back to your post.",
      "Rule nine. Do not count the doors on the way out.",
      "Rule ten. If you hear typing from an empty office, finish your shift early. It's covering for you.",
    ],
    end: [
      "Last rule. If you've already broken one, you'll know, because this list will look different tomorrow.",
      "Final rule. Read this list again from the top. Notice anything missing?",
    ],
  },
  notice: {
    hook: [
      "Welcome to the {S}. Please read this notice about {A} carefully. Your safety depends on it.",
      "Attention residents of the {S}. A small update regarding {A}.",
    ],
    mid: [
      "Quiet hours are from ten PM to six AM. During quiet hours, do not respond to any knocking. Residents do not knock.",
      "The building manager is a tall man in a grey suit. We do not have a building manager.",
      "If your hallway is longer than usual, keep walking. Do not turn around.",
      "Packages left at your door after midnight were not delivered by us. Do not open them. Do not bring them inside.",
      "Your neighbor in unit 4B moved out last year. If they greet you, smile and keep moving.",
      "The elevator may stop at a floor with no lights. Do not step out, even if someone calls your name.",
      "Please make sure your door is locked. Then check again. It will try once more around three.",
      "If you see this notice taped to the inside of your door, you did not put it there.",
      "Residents who follow these rules report a pleasant stay.",
    ],
    end: [
      "Thank you for your cooperation. We'll see you soon. We always do. Welcome to the {S}.",
      "This notice will repeat. If it does, start from the beginning. Welcome to the {S}.",
    ],
  },
  broadcast: {
    hook: [
      "This is an emergency broadcast. Residents near the {S} must stay indoors. Do not look at {A}.",
      "Tape recovered. Date unknown. Subject: the {S}. Playback begins now.",
    ],
    mid: [
      "Cover all windows facing the street. Do not open the door for emergency services. We have not sent any.",
      "If you hear this message in a voice you recognize, turn off your television immediately.",
      "Reports confirm the {S} now appears on maps where it did not exist yesterday.",
      "Count the members of your household. If the number is higher than it should be, do not say so out loud.",
      "The following image is not a test pattern. Do not stare at it for longer than four seconds.",
      "This broadcast was recorded seven hours from now.",
      "Remain calm. It responds to fear the way a dog responds to its name.",
      "Signal interference detected. If the announcer's face appears on your screen, it is not the announcer.",
    ],
    end: [
      "This message will repeat. This message will repeat. This message will—",
      "End of broadcast. If you are still watching, it already knows your address.",
    ],
  },
  file: {
    hook: [
      "Item: the {S}. Object class: Keter. Do not enter {A} under any circumstances.",
      "File seven three nine. The {S}. Containment requires that {A} remain sealed at all times.",
    ],
    mid: [
      "Containment procedures: no personnel may remain inside for longer than forty minutes.",
      "Description: the structure contains more rooms on the inside than its outer walls allow.",
      "Personnel report hearing their own voice from adjacent rooms, giving instructions they never gave.",
      "Incident log, day four: a researcher entered the third floor. She exited from the basement eleven hours later.",
      "She described the trip as taking roughly thirty seconds.",
      "Floor plans drawn inside the structure never match floor plans drawn outside it.",
      "Do not attempt to communicate with residents. There are no residents.",
      "Testing has been suspended after the anomaly began requesting specific researchers by name.",
    ],
    end: [
      "Final note: the anomaly has requested your clearance level. Access to this file has been logged.",
      "Addendum: the rest of this file has been redacted. By the {S}.",
    ],
  },
  story: {
    hook: [
      "I knew something was wrong at the {S} the night I found {A}.",
      "The thing in the {S} is still there. I need to tell you about {A} before it's too late.",
    ],
    mid: [
      "It started small. A door I'd locked was open. My keys were on the wrong hook.",
      "My neighbor said nobody had lived in the unit above me for years. I heard footsteps every night.",
      "At exactly three thirty three, the footsteps stopped, and something started breathing at my door.",
      "I checked the peephole. The hallway was empty, but the breathing kept going.",
      "The next morning, every photo on my phone from that night had a figure in the background.",
      "Closer in every one.",
      "I asked the old woman downstairs. She just said, you must have answered it.",
      "I don't remember answering anything. But my door was unlocked from the inside.",
    ],
    end: [
      "I moved out last week. Last night, I heard footsteps above my new apartment.",
      "I'm telling you this so you'll recognize it. It's on its way to you next.",
    ],
  },
};

function writeScript(input: { idea: string; angle?: string; format: Format; lengthSec: number; request?: string }): Script {
  const r = rng(input.idea + input.format.name);
  const S = subjectOf(input.request || input.idea);
  const pick = ANGLES[Math.floor(r() * ANGLES.length)];
  const A = input.angle && input.angle.length <= 40 && !/^make\b/i.test(input.angle) ? input.angle : pick;
  const pool = POOLS[family(input.format)];
  const fill = (s: string) => s.replaceAll("{S}", S).replaceAll("{A}", A);
  const target = Math.round(input.lengthSec * 2.5);
  const nMid = Math.max(3, Math.min(pool.mid.length, Math.round(target / 13) - 2));
  const lines = [
    fill(pool.hook[Math.floor(r() * pool.hook.length)]),
    ...shuffle(pool.mid, r).slice(0, nMid).map(fill),
    fill(pool.end[Math.floor(r() * pool.end.length)]),
  ];
  if (family(input.format) === "rules") {
    // keep numbered rules in order
    const mids = lines.slice(1, -1).sort((a, b) => order(a) - order(b));
    lines.splice(1, mids.length, ...mids);
  }
  const title = `${cap(S)}: ${cap(A)}`;
  return {
    title,
    hook: lines[0],
    lines,
    caption: `${title}. Would you have followed the rules?`,
    hashtags: ["#horror", "#scary", "#creepy", "#" + input.format.name.toLowerCase().replace(/[^a-z]/g, "")],
  };
}
const NUM = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const order = (s: string) => {
  const m = s.toLowerCase().match(/^rule (\w+)/);
  return m ? NUM.indexOf(m[1]) : 99;
};
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
            search: keywords(l, i.format?.visualStyle || "dark hallway"),
          })),
        };
        break;
    }
    return { text: JSON.stringify(out), model: "offline", inputTokens: 0, outputTokens: 0, cost: 0 };
  },
};
