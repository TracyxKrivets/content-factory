import type { Format, Script } from "../types";

// Keep prompts short and structured. Only send what the step needs.

export const WORDS_PER_SEC = 2.5;
export const targetWords = (sec: number) => Math.round(sec * WORDS_PER_SEC);
export const targetLines = (sec: number) => Math.max(5, Math.min(14, Math.round(targetWords(sec) / 11)));

export function ideasPrompt(request: string, format: Format, count: number) {
  return {
    system: "You plan short-form video series. Reply with JSON only.",
    prompt: `Request: ${request.slice(0, 400)}
Format: ${format.name}: ${format.description}
Give ${count} distinct video ideas. Each needs a different angle (place, object, rule, character, time).
JSON: {"ideas":[{"title":"max 8 words","angle":"one sentence"}]}`,
    maxTokens: 120 + count * 60,
  };
}

function scriptSystem(format: Format, language: string) {
  return `You write viral ${format.name} narration scripts for TikTok, Reels and Shorts.
Rules: line 1 is the hook and must grab in 2 seconds. No intro, no greeting, no "today". Every line escalates. End on a twist or a line that loops back to the start. Spoken words only, no stage directions or emojis. Write in ${language}.`;
}

function scriptSpec(format: Format, lengthSec: number) {
  return `Hook style: ${format.hookStyle}
Structure: ${format.structure}
Narrator: ${format.voiceStyle}
Length: ${lengthSec}s = about ${targetWords(lengthSec)} words in ${targetLines(lengthSec)} lines (one beat per line, max 22 words each).
JSON: {"title":"max 8 words","lines":["..."],"caption":"one-sentence social caption","hashtags":["#tag"]}`;
}

export function scriptPrompt(o: { idea: string; request: string; format: Format; lengthSec: number; language: string }) {
  return {
    system: scriptSystem(o.format, o.language),
    prompt: `Idea: ${o.idea}
Series: ${o.request.slice(0, 300)}
${scriptSpec(o.format, o.lengthSec)}`,
    maxTokens: 900,
  };
}

export function rewritePrompt(o: { script: Script; issues: string[]; format: Format; lengthSec: number; language: string }) {
  return {
    system: scriptSystem(o.format, o.language),
    prompt: `Rewrite this draft and fix the issues. Keep what works.
Draft:
${o.script.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}
Issues: ${o.issues.join("; ")}
${scriptSpec(o.format, o.lengthSec)}`,
    maxTokens: 900,
  };
}

export function checkPrompt(script: Script, lengthSec: number) {
  return {
    system: "You are a strict short-form horror script editor. Reply with JSON only.",
    prompt: `Target: ${lengthSec}s spoken.
${script.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}
Score 1-10: hook (grabs in 2s), pacing, escalation, ending (twist or loop). List concrete fixes. pass=true only if every score >= 7.
JSON: {"hook":0,"pacing":0,"escalation":0,"ending":0,"issues":["..."],"pass":true}`,
    maxTokens: 300,
  };
}

export function scenesPrompt(lines: string[], format: Format) {
  return {
    system: "You write image prompts for vertical horror videos. Reply with JSON only.",
    prompt: `Visual style: ${format.visualStyle}
For each numbered line write one image prompt (max 30 words: concrete subject, setting, lighting; same style throughout; no text in image; no two alike) and 2-4 stock photo search keywords.
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}
JSON: {"scenes":[{"visual":"...","search":"..."}]} with exactly ${lines.length} items.`,
    maxTokens: 120 + lines.length * 80,
  };
}
