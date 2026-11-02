// Pure helper (safe for client + server): pick a format from the request text.
const ALIASES: Record<string, string[]> = {
  "did you know": ["did you know", "fact", "facts", "trivia", "explainer"],
  "top 5 list": ["top 5", "top five", "top 10", "top ten", "list", "ranking", "countdown"],
  storytime: ["storytime", "story time", "my story", "true story"],
  motivation: ["motivation", "motivational", "mindset", "discipline", "inspire"],
  "product spotlight": ["product", "review", "ad ", "ads", "promo", "unboxing"],
  "scary story": ["scary", "horror", "creepy", "creepypasta", "ghost", "haunted", "urban legend", "napolitan"],
};

export function detectFormat<T extends { id: string; name: string; isDefault?: boolean }>(request: string, formats: T[]): T | undefined {
  const r = " " + request.toLowerCase().replace(/[-_]/g, " ") + " ";
  let best: { f: T; score: number } | undefined;
  for (const f of formats) {
    const name = f.name.toLowerCase();
    const words = [name, ...(ALIASES[name] || [])];
    const score = Math.max(0, ...words.map((w) => (r.includes(w) ? w.length : 0)));
    if (score > (best?.score || 0)) best = { f, score };
  }
  return best?.f || formats.find((f) => f.isDefault) || formats[0];
}

/** "Make 10 ..." / "3 fact shorts" -> number of videos (1-50). */
export function parseCount(request: string) {
  const lead = request.match(/^\s*(?:please\s+)?(?:make|create|generate|give me|write|do)\s+(?:me\s+)?(\d{1,2})\b/i);
  const noun = request.match(
    /\b(\d{1,2})\s+(?:[\w'/-]+\s+){0,5}?(videos?|shorts?|reels?|tiktoks?|clips?|stories|story|episodes?|parts?|files?|entries|posts?|scripts?|tales?|legends?)\b/i,
  );
  const n = Number(lead?.[1] || noun?.[1] || 1);
  return Math.min(50, Math.max(1, n));
}
