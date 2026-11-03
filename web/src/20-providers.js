// ---------------------------------------------------------------- formats (stored in this browser)
async function listFormats() {
  let rows = await db.all("formats");
  if (!rows.length && !(await kv.get("seeded"))) {
    const t = Date.now();
    for (const [i, { key, ...rest }] of STARTER_FORMATS.entries())
      await db.put("formats", { ...rest, id: key, isDefault: i === 0, isStarter: true, createdAt: new Date(t + i).toISOString(), updatedAt: now() });
    await kv.set("seeded", true);
    rows = await db.all("formats");
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
const FORMAT_FIELDS = ["name", "emoji", "description", "hookStyle", "structure", "visualStyle", "voiceStyle", "captionStyle", "musicStyle", "lengthSec"];
const cleanFormat = (p) => {
  const o = {};
  for (const k of FORMAT_FIELDS) if (p[k] !== undefined) o[k] = p[k];
  if (o.lengthSec !== undefined) o.lengthSec = clamp(Number(o.lengthSec) || 40, 15, 90);
  return o;
};
async function createFormat(p = {}) {
  const base = STARTER_FORMATS[0];
  const { key, ...rest } = base;
  return db.put("formats", { ...rest, name: "My Format", emoji: "✨", ...cleanFormat(p), id: uid(), isDefault: false, isStarter: false, createdAt: now(), updatedAt: now() });
}
async function setDefaultFormat(id) {
  for (const f of await listFormats()) if (f.isDefault !== (f.id === id)) await db.put("formats", { ...f, isDefault: f.id === id });
}
async function deleteFormat(id) {
  const f = await db.get("formats", id);
  await db.del("formats", id);
  if (f?.isDefault) {
    const next = (await listFormats())[0];
    if (next) await setDefaultFormat(next.id);
  }
}
async function restoreStarters() {
  const have = new Set((await db.all("formats")).map((f) => f.id));
  for (const { key, ...rest } of STARTER_FORMATS)
    if (!have.has(key)) await db.put("formats", { ...rest, id: key, isDefault: false, isStarter: true, createdAt: now(), updatedAt: now() });
}

// ---------------------------------------------------------------- pricing (rough USD estimates)
const TOKEN_PRICES = { "gpt-4.1-mini": [0.4, 1.6], "gpt-4.1": [2, 8], "claude-haiku-5-5": [1, 5], "claude-sonnet-5-5": [3, 15] };
function tokenCost(model, i, o) {
  const k = Object.keys(TOKEN_PRICES).find((m) => model.startsWith(m));
  const [a, b] = k ? TOKEN_PRICES[k] : [3, 15];
  return (i * a + o * b) / 1e6;
}
const PRICE = { openaiTtsPerChar: 0.000015, elevenlabsPerChar: 0.00018, openaiImage: 0.106, whisperPerMinute: 0.006 };
const MODELS = {
  anthropic: { cheap: "claude-haiku-5-5", quality: "claude-sonnet-5-5" },
  openai: { cheap: "gpt-4.1-mini", quality: "gpt-4.1" },
};
const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

// ---------------------------------------------------------------- AI writers
const anthropicLlm = {
  id: "anthropic", label: "Anthropic Claude", cap: "llm",
  available: () => !!keys.get("ANTHROPIC_API_KEY"),
  async complete(r) {
    const model = MODELS.anthropic[r.tier];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: timeout(120000),
      headers: {
        "x-api-key": keys.get("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01",
        "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: r.maxTokens, system: r.system + "\nReply with JSON only.", messages: [{ role: "user", content: r.prompt }] }),
    });
    if (!res.ok) throw await httpError(res, "anthropic");
    const j = await res.json();
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    if (!text) throw new ProviderError("bad_output", "Empty reply from Anthropic", { provider: "anthropic", retryable: true });
    const i = j.usage?.input_tokens || 0, o = j.usage?.output_tokens || 0;
    return { text, model, cost: tokenCost(model, i, o) };
  },
};
const openaiLlm = {
  id: "openai", label: "OpenAI", cap: "llm",
  available: () => !!keys.get("OPENAI_API_KEY"),
  async complete(r) {
    const model = MODELS.openai[r.tier];
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: timeout(120000),
      headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_completion_tokens: r.maxTokens, response_format: { type: "json_object" },
        messages: [{ role: "system", content: r.system }, { role: "user", content: r.prompt }],
      }),
    });
    if (!res.ok) throw await httpError(res, "openai");
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || "";
    if (!text) throw new ProviderError("bad_output", "Empty reply from OpenAI", { provider: "openai", retryable: true });
    return { text, model, cost: tokenCost(model, j.usage?.prompt_tokens || 0, j.usage?.completion_tokens || 0) };
  },
};
const offlineLlm = {
  id: "offline-writer", label: "Practice writer (templates)", cap: "llm", offline: true,
  available: () => true,
  async complete(r) {
    const i = r.input || {};
    let out;
    if (r.task === "ideas") {
      const g = rng(i.request || "x");
      const S = subjectOf(i.request || "");
      out = { ideas: shuffle(ANGLES, g).slice(0, i.count || 1).map((a) => ({ title: `${cap(S)}: ${cap(a)}`, angle: a })) };
    } else if (r.task === "script" || r.task === "rewrite") out = writeScript(i);
    else if (r.task === "check") out = { hook: 7, pacing: 7, escalation: 7, ending: 7, issues: [], pass: true };
    else if (r.task === "scenes")
      out = { scenes: i.lines.map((l) => ({ visual: `${l} ${i.format?.visualStyle || ""}`.slice(0, 300), search: keywords(l, i.format?.visualStyle || "city street") })) };
    return { text: JSON.stringify(out), model: "offline", cost: 0 };
  },
};

// ---------------------------------------------------------------- voices
const elevenlabsVoice = {
  id: "elevenlabs", label: "ElevenLabs", cap: "voice",
  available: () => !!keys.get("ELEVENLABS_API_KEY"),
  async speak({ text }) {
    const voice = LS.getItem("cf-eleven-voice") || "pNInz6obpgDQGcFmaJgB";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST", signal: timeout(180000),
      headers: { "xi-api-key": keys.get("ELEVENLABS_API_KEY"), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3 } }),
    });
    if (!res.ok) throw await httpError(res, "elevenlabs");
    return { blob: await res.blob(), cost: text.length * PRICE.elevenlabsPerChar };
  },
};
const openaiVoice = {
  id: "openai-tts", label: "OpenAI voice", cap: "voice",
  available: () => !!keys.get("OPENAI_API_KEY"),
  async speak({ text, style }) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", signal: timeout(180000),
      headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts", voice: "onyx", input: text, response_format: "mp3",
        instructions: `Speak in a ${style} tone. Short-form video narration: clear, engaging, well-paced.`,
      }),
    });
    if (!res.ok) throw await httpError(res, "openai-tts");
    return { blob: await res.blob(), cost: text.length * PRICE.openaiTtsPerChar };
  },
};
/** Practice mode: no narration. The video is captions + music, timed at a natural reading pace. */
const noVoice = {
  id: "no-voice", label: "No voice (text + music)", cap: "voice", offline: true,
  available: () => true,
  async speak({ text }) {
    return { blob: null, duration: Math.max(6, text.split(/\s+/).length / 2.6 + 1), cost: 0 };
  },
};

// ---------------------------------------------------------------- images
const W = 1080, H = 1920;
const openaiImage = {
  id: "openai-image", label: "OpenAI images", cap: "image",
  available: () => !!keys.get("OPENAI_API_KEY"),
  async generate({ prompt }) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", signal: timeout(180000),
      headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-2", prompt: `${prompt}. Vertical 9:16 cinematic frame, no text, no watermark.`, size: "1024x1536", quality: "medium", n: 1 }),
    });
    if (!res.ok) throw await httpError(res, "openai-image");
    const b64 = (await res.json()).data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("bad_output", "No image returned", { provider: "openai-image" });
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return { blob: new Blob([bin], { type: "image/png" }), cost: PRICE.openaiImage };
  },
};
const pexelsImage = {
  id: "pexels", label: "Pexels stock photos", cap: "image",
  available: () => !!keys.get("PEXELS_API_KEY"),
  async generate({ search, format, avoid }) {
    for (const q of [search, `${search} cinematic`, format.visualStyle.split(",")[0]]) {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=portrait&per_page=20`, {
        headers: { Authorization: keys.get("PEXELS_API_KEY") }, signal: timeout(30000),
      });
      if (!res.ok) throw await httpError(res, "pexels");
      const pick = ((await res.json()).photos || []).find((p) => !avoid.includes(String(p.id)));
      if (!pick) continue;
      const img = await fetch(pick.src.portrait || pick.src.large2x, { signal: timeout(60000) });
      if (!img.ok) throw await httpError(img, "pexels");
      return { blob: await img.blob(), cost: 0, sourceId: String(pick.id) };
    }
    throw new ProviderError("bad_output", `No stock photos for "${search}"`, { provider: "pexels" });
  },
};
function hsl(h, s, l) {
  return `hsl(${h} ${s}% ${l}%)`;
}
/** Practice background: colorful gradient + soft shapes, drawn on a canvas (captions carry the words). */
const offlineImage = {
  id: "offline-cards", label: "Color backgrounds (practice)", cap: "image", offline: true,
  available: () => true,
  async generate({ search, format }) {
    const hv = parseInt((await hash(format.visualStyle, search)).slice(0, 6), 16);
    const hue = hv % 360;
    const dark = /dark|night|grain|horror|creepy|shadow|cold light/i.test(format.visualStyle);
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, W * 0.3, H);
    grd.addColorStop(0, dark ? hsl(hue, 50, 20) : hsl(hue, 70, 52));
    grd.addColorStop(1, dark ? hsl((hue + 30) % 360, 30, 4) : hsl((hue + 40) % 360, 75, 28));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // soft shapes for depth
    const r = rng(search);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(255,255,255,${dark ? 0.03 : 0.07})`;
      g.beginPath();
      g.arc(r() * W, r() * H, 120 + r() * 380, 0, Math.PI * 2);
      g.fill();
    }
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(0,0,0,${dark ? 0.75 : 0.35})`);
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    return { blob: await c.convertToBlob({ type: "image/png" }), cost: 0 };
  },
};
function wrapWords(t, n) {
  const out = [];
  let line = "";
  for (const w of t.split(/\s+/)) {
    if ((line + " " + w).trim().length > n && line) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

// ---------------------------------------------------------------- caption timing
const estimatedCaptions = {
  id: "estimated", label: "Estimated timing (free)", cap: "captions", offline: true,
  available: () => true,
  async timings({ text, duration }) {
    const words = text.split(/\s+/).filter(Boolean);
    const weight = (w) => w.length + 2 + (/[.!?]$/.test(w) ? 6 : /[,;:—]$/.test(w) ? 3 : 0);
    const total = words.reduce((s, w) => s + weight(w), 0) || 1;
    const lead = Math.min(0.2, duration * 0.02);
    const usable = Math.max(0.5, duration - lead - 0.15);
    let t = lead;
    return {
      words: words.map((w) => {
        const d = (weight(w) / total) * usable;
        const o = { word: w, start: t, end: t + d };
        t += d;
        return o;
      }),
      cost: 0,
    };
  },
};
const whisperCaptions = {
  id: "openai-whisper", label: "OpenAI exact timing", cap: "captions",
  available: () => !!keys.get("OPENAI_API_KEY"),
  async timings({ audio, duration }) {
    if (!audio) throw new ProviderError("missing_asset", "No voice audio to time", { provider: "openai-whisper" });
    const form = new FormData();
    form.append("file", audio, "voice.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", body: form, signal: timeout(120000), headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}` },
    });
    if (!res.ok) throw await httpError(res, "openai-whisper");
    const words = ((await res.json()).words || []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
    if (!words.length) throw new ProviderError("bad_output", "No word timings", { provider: "openai-whisper" });
    return { words, cost: (duration / 60) * PRICE.whisperPerMinute };
  },
};

// ---------------------------------------------------------------- registry + fallback chain
const REGISTRY = {
  llm: [anthropicLlm, openaiLlm, offlineLlm],
  voice: [elevenlabsVoice, openaiVoice, noVoice],
  image: [openaiImage, pexelsImage, offlineImage],
  captions: [estimatedCaptions, whisperCaptions],
};
const down = new Map(); // circuit breaker: provider -> until
const isDown = (id) => (down.get(id) || 0) > Date.now();
function chain(cap, avoid = []) {
  const order = JSON.parse(LS.getItem("cf-order") || "{}")[cap] || [];
  const all = REGISTRY[cap];
  const rank = (p) => (order.indexOf(p.id) >= 0 ? order.indexOf(p.id) : 100 + all.indexOf(p)) + (isDown(p.id) ? 1000 : 0);
  const usable = all.filter((p) => p.available() && !avoid.includes(p.id)).sort((a, b) => rank(a) - rank(b));
  if (cap === "captions") return usable;
  const online = usable.filter((p) => !p.offline);
  return online.length ? online : usable.filter((p) => p.offline);
}
const providerById = (id) => Object.values(REGISTRY).flat().find((p) => p.id === id);
const PRACTICE_IDS = new Set(["offline-writer", "no-voice", "offline-cards"]);
function practiceMode() {
  return ["llm", "voice", "image"].some((c) => !REGISTRY[c].some((p) => !p.offline && p.available()));
}
