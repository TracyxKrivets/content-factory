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
/** Claude models you can pick for writing scripts and for the change-the-app chat. */
const CLAUDE_MODELS = [
  ["claude-opus-5-5", "Opus 5.5", "best writing, slower"],
  ["claude-sonnet-5-5", "Sonnet 5.5", "great + fast (recommended)"],
  ["claude-haiku-5-5", "Haiku 5.5", "fastest, simplest"],
];
const modelChoice = (role) => loadSetting("cf-models", {})[role] || "claude-sonnet-5-5";
TOKEN_PRICES["claude-opus-5-5"] = [5, 25];

// Inside claude.ai the page can't reach other websites, so key-based services are off there.
const CLAUDE = () => window.__cfClaude || { inClaude: false };
const canFetch = () => !CLAUDE().inClaude;
const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------- AI writers
/** Writer on the viewer's own Claude account (only when the app runs inside claude.ai). */
const claudeAccountLlm = {
  id: "claude-account", label: "Your Claude account", cap: "llm",
  available: () => !!CLAUDE().sample && !CLAUDE().declined,
  async complete(r) {
    const model = r.tier === "quality" ? modelChoice("writer") : "claude-haiku-5-5";
    const tier = model === "claude-opus-5-5" ? "complex" : model === "claude-haiku-5-5" ? "quick" : "default";
    try {
      const opts = { model, modelTier: tier, cache: false };
      if (r.images?.length) {
        const lim = await CLAUDE().sample.limits().catch(() => null);
        if (!lim?.images) throw new ProviderError("missing_key", "This Claude view can't look at pictures", { provider: "claude-account" });
        opts.images = r.images.slice(0, lim.images.maxCount || 8);
      }
      const { text } = await CLAUDE().sample(`${r.system}\n\n${r.prompt}\n\nReply with only the JSON, no other text.`, opts);
      return { text, model, cost: 0 };
    } catch (e) {
      throw sampleProviderError(e);
    }
  },
};
function sampleProviderError(e) {
  const c = e?.code;
  const m = `Claude account: ${c || "error"} ${e?.message || ""}`;
  if (c === "not_granted" || c === "sampling_disabled" || c === "session_expired") {
    if (c === "not_granted") CLAUDE().declined = true;
    return new ProviderError("auth", m, { provider: "claude-account" });
  }
  if (c === "rate_limited") return new ProviderError("quota", m, { provider: "claude-account", retryable: false });
  if (c === "refused") return new ProviderError("content_blocked", m, { provider: "claude-account" });
  if (c === "invalid_json" || c === "empty_completion") return new ProviderError("bad_output", m, { provider: "claude-account", retryable: true });
  if (c === "upstream_error") return new ProviderError("network", m, { provider: "claude-account", retryable: true });
  return new ProviderError("unknown", m, { provider: "claude-account" });
}
const anthropicLlm = {
  id: "anthropic", label: "Anthropic API", cap: "llm",
  available: () => canFetch() && !!keys.get("ANTHROPIC_API_KEY"),
  async complete(r) {
    const model = r.tier === "quality" ? modelChoice("writer") : MODELS.anthropic.cheap;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: timeout(120000),
      headers: {
        "x-api-key": keys.get("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01",
        "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model, max_tokens: r.maxTokens, system: r.system + "\nReply with JSON only.",
        messages: [{
          role: "user",
          content: r.images?.length
            ? [...(await Promise.all(r.images.map(blobToBase64))).map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })), { type: "text", text: r.prompt }]
            : r.prompt,
        }],
      }),
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
  id: "openai", label: "OpenAI API", cap: "llm",
  available: () => canFetch() && !!keys.get("OPENAI_API_KEY"),
  async complete(r) {
    const model = MODELS.openai[r.tier];
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: timeout(120000),
      headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_completion_tokens: r.maxTokens, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: r.system },
          {
            role: "user",
            content: r.images?.length
              ? [{ type: "text", text: r.prompt }, ...(await Promise.all(r.images.map(blobToBase64))).map((d) => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + d } }))]
              : r.prompt,
          },
        ],
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
  available: () => canFetch() && !!keys.get("ELEVENLABS_API_KEY"),
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
  available: () => canFetch() && !!keys.get("OPENAI_API_KEY"),
  async speak({ text, style, language }) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", signal: timeout(180000),
      headers: { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts", voice: "onyx", input: text, response_format: "mp3",
        instructions: `Speak in a ${style} tone, in natural native ${language || "English"}. Short-form video narration: clear, engaging, well-paced.`,
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
  async speak({ text, language = "English" }) {
    // reading pace per language (Chinese/Japanese/Thai count characters, not spaces)
    const rate = CHAR_RATE[language] || WORD_RATE[language] || 2.6;
    return { blob: null, duration: Math.max(6, countUnits(text, language) / rate + 1), cost: 0 };
  },
};

// ---------------------------------------------------------------- images
const W = 1080, H = 1920;
const openaiImage = {
  id: "openai-image", label: "OpenAI images", cap: "image",
  available: () => canFetch() && !!keys.get("OPENAI_API_KEY"),
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
// ---- Google Gemini: writer, images (Nano Banana), voice. Model names change often, so we ask
// Google which models this key can use and pick the newest, falling back to Google's "latest" aliases.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULTS = { flash: "gemini-flash-latest", pro: "gemini-pro-latest", image: "gemini-3.1-flash-image", tts: "gemini-3.8-flash-tts" };
const gemVer = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0) * 10 + (/preview|exp/.test(id) ? 0 : 1);
function pickGeminiModels(list) {
  const ids = (list || []).filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map((m) => String(m.name || "").replace(/^models\//, ""));
  const best = (re) => ids.filter((i) => re.test(i)).sort((a, b) => gemVer(b) - gemVer(a))[0];
  return {
    flash: best(/^gemini-\d+(\.\d+)?-flash(-preview)?$/) || GEMINI_DEFAULTS.flash,
    pro: best(/^gemini-\d+(\.\d+)?-pro(-preview)?$/) || GEMINI_DEFAULTS.pro,
    image: best(/^gemini-\d+(\.\d+)?-flash-image(-preview)?$/) || best(/^gemini-.*-image(-preview)?$/) || GEMINI_DEFAULTS.image,
    tts: best(/^gemini-\d+(\.\d+)?-flash-tts(-preview)?$/) || best(/^gemini-\d+(\.\d+)?-flash-preview-tts$/) || best(/tts/) || GEMINI_DEFAULTS.tts,
  };
}
async function discoverGemini(key = keys.get("GEMINI_API_KEY")) {
  const res = await fetch(`${GEMINI}/models?pageSize=1000`, { headers: { "x-goog-api-key": key }, signal: timeout(20000) });
  if (!res.ok) throw await httpError(res, "gemini");
  const m = pickGeminiModels((await res.json()).models);
  saveSetting("cf-gemini-models", { ...m, key: key.slice(-6) });
  return m;
}
async function geminiModels() {
  const saved = loadSetting("cf-gemini-models", null);
  if (saved && saved.key === keys.get("GEMINI_API_KEY").slice(-6)) return saved;
  try {
    return await discoverGemini();
  } catch {
    return GEMINI_DEFAULTS;
  }
}
const geminiSettings = () => ({ writer: "flash", voice: "Charon", ...loadSetting("cf-gemini", {}) });
async function geminiCall(model, body, ms = 120000) {
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: "POST", signal: timeout(ms),
    headers: { "x-goog-api-key": keys.get("GEMINI_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, "gemini");
  const j = await res.json();
  const parts = j.candidates?.[0]?.content?.parts || [];
  const why = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason;
  return { j, parts, why };
}
const geminiLlm = {
  id: "gemini", label: "Google Gemini", cap: "llm",
  available: () => canFetch() && !!keys.get("GEMINI_API_KEY"),
  async complete(r) {
    const m = await geminiModels();
    const model = r.tier === "quality" && geminiSettings().writer === "pro" ? m.pro : m.flash;
    const images = r.images?.length ? (await Promise.all(r.images.map(blobToBase64))).map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })) : [];
    const { j, parts, why } = await geminiCall(model, {
      systemInstruction: { parts: [{ text: r.system + "\nReply with JSON only." }] },
      contents: [{ role: "user", parts: [...images, { text: r.prompt }] }],
      // newer models think before answering, which uses output tokens: leave room for both
      generationConfig: { maxOutputTokens: (r.maxTokens || 1000) + 6000, responseMimeType: "application/json" },
    });
    const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join("");
    if (!text) throw new ProviderError(/SAFETY|BLOCK|PROHIBITED/.test(why || "") ? "content_blocked" : "bad_output", `Empty reply from Gemini (${why || "no text"})`, { provider: "gemini", retryable: !/SAFETY|BLOCK/.test(why || "") });
    const u = j.usageMetadata || {};
    const [pi, po] = /pro/.test(model) ? [2, 12] : [1.5, 9];
    return { text, model, cost: ((u.promptTokenCount || 0) * pi + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * po) / 1e6 };
  },
};
const geminiImage = {
  id: "gemini-image", label: "Gemini images (Nano Banana)", cap: "image",
  available: () => canFetch() && !!keys.get("GEMINI_API_KEY"),
  async generate({ prompt }) {
    const { image } = await geminiModels();
    const { parts, why } = await geminiCall(image, {
      contents: [{ role: "user", parts: [{ text: `${prompt}. Vertical 9:16 photo for a short-form video. No text, letters, logos or watermarks.` }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } },
    });
    const img = parts.find((x) => x.inlineData?.data);
    if (!img) throw new ProviderError(/SAFETY|BLOCK|PROHIBITED/.test(why || "") ? "content_blocked" : "bad_output", `Gemini made no image (${why || "empty"})`, { provider: "gemini-image", retryable: true });
    return { blob: b64Blob(img.inlineData.data, img.inlineData.mimeType || "image/png"), cost: 0.045 };
  },
};
const geminiVoice = {
  id: "gemini-tts", label: "Gemini voice", cap: "voice",
  available: () => canFetch() && !!keys.get("GEMINI_API_KEY"),
  async speak({ text, style, language }) {
    const { tts } = await geminiModels();
    const { parts, why } = await geminiCall(tts, {
      contents: [{ role: "user", parts: [{ text: `Read this aloud in a ${style || "clear, engaging"} tone, in natural native ${language || "English"}, as short-form video narration:\n\n${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiSettings().voice } } } },
    }, 180000);
    const a = parts.find((x) => x.inlineData?.data);
    if (!a) throw new ProviderError("bad_output", `Gemini made no audio (${why || "empty"})`, { provider: "gemini-tts", retryable: true });
    const rate = Number((a.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1] || 24000);
    const blob = /wav|mp3|mpeg|ogg/.test(a.inlineData.mimeType || "") ? b64Blob(a.inlineData.data, a.inlineData.mimeType) : pcmToWav(b64Bytes(a.inlineData.data), rate);
    return { blob, cost: (text.length / 14) * 25 * 20 / 1e6 + 0.0005 };
  },
};
const b64Bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64Blob = (b64, type) => new Blob([b64Bytes(b64)], { type });
/** Gemini voice sends raw 16-bit mono PCM; wrap it in a WAV header so browsers can play it. */
function pcmToWav(pcm, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); h.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true);
  h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, "data"); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, pcm], { type: "audio/wav" });
}

// ---- Sora (OpenAI video): realistic moving clips per scene. Opt-in only: it's the priciest option.
const SORA_MODELS = [
  ["sora-2", "Sora 2", 0.1, "realistic, $0.10 per second"],
  ["sora-2-pro", "Sora 2 Pro", 0.3, "most realistic, $0.30 per second"],
];
const SORA_SECONDS = [4, 8, 12];
const soraSettings = () => ({ model: "sora-2", mode: "all", ...loadSetting("cf-sora", {}) });
const soraPrice = (model) => (SORA_MODELS.find((m) => m[0] === model) || SORA_MODELS[0])[2];
/** Shortest clip length Sora offers that covers the scene. */
const soraClipSec = (sec) => SORA_SECONDS.find((x) => x >= sec - 0.3) || SORA_SECONDS[SORA_SECONDS.length - 1];
const soraVideo = {
  id: "sora", label: "Sora AI video", cap: "image", optIn: true,
  available: () => canFetch() && !!keys.get("OPENAI_API_KEY"),
  async generate({ prompt, seconds }) {
    const { model } = soraSettings();
    const secs = soraClipSec(seconds || 4);
    const auth = { Authorization: `Bearer ${keys.get("OPENAI_API_KEY")}` };
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", `${prompt}. Vertical 9:16, photorealistic, natural motion, smooth camera movement. No text, captions, logos or watermarks. No real or famous people.`);
    form.append("seconds", String(secs));
    form.append("size", "720x1280");
    let res = await fetch("https://api.openai.com/v1/videos", { method: "POST", headers: auth, body: form, signal: timeout(60000) });
    if (!res.ok) throw await httpError(res, "sora");
    let job = await res.json();
    const t0 = Date.now();
    while (job.status !== "completed") {
      if (job.status === "failed" || job.error)
        throw new ProviderError("bad_output", `Sora couldn't make this scene: ${job.error?.message || "it was refused or failed"}`, { provider: "sora", retryable: false });
      if (Date.now() - t0 > 15 * 60000) throw new ProviderError("timeout", "Sora took more than 15 minutes on one scene", { provider: "sora", retryable: false });
      await sleep(job.status === "queued" ? 8000 : 5000);
      res = await fetch(`https://api.openai.com/v1/videos/${job.id}`, { headers: auth, signal: timeout(30000) });
      if (!res.ok) throw await httpError(res, "sora");
      job = await res.json();
    }
    const file = await fetch(`https://api.openai.com/v1/videos/${job.id}/content`, { headers: auth, signal: timeout(180000) });
    if (!file.ok) throw await httpError(file, "sora");
    const blob = await file.blob();
    if (blob.size < 1000) throw new ProviderError("bad_output", "Sora sent back an empty clip", { provider: "sora", retryable: true });
    return { blob: blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" }), video: true, cost: secs * soraPrice(model), sourceId: job.id };
  },
};
const pexelsImage = {
  id: "pexels", label: "Pexels stock photos", cap: "image",
  available: () => canFetch() && !!keys.get("PEXELS_API_KEY"),
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
/**
 * Split narration into caption pieces. Languages without spaces (Chinese, Japanese, Thai)
 * are cut at punctuation and every few characters; glue=true means "no space after this".
 */
function captionTokens(text, language) {
  const noSpaces = byChars(language) || (text.length > 20 && text.split(/\s+/).length < text.length / 15);
  if (!noSpaces) return text.split(/\s+/).filter(Boolean).map((t) => ({ text: t, glue: false }));
  const size = language === "Thai" ? 9 : 6;
  const out = [];
  for (const seg of text.split(/(?<=[。！？!?，、,.;；：:…\s])/u)) {
    const s = [...seg.trim()];
    // split evenly so no tiny leftover piece ("る。") ends up on its own
    const pieces = Math.ceil(s.length / size) || 0;
    const per = pieces ? Math.ceil(s.length / pieces) : 0;
    for (let i = 0; i < s.length; i += per) out.push({ text: s.slice(i, i + per).join(""), glue: true });
    if (out.length && /\s$/.test(seg)) out[out.length - 1].glue = false;
  }
  return out.filter((t) => t.text);
}
const estimatedCaptions = {
  id: "estimated", label: "Estimated timing (free)", cap: "captions", offline: true,
  available: () => true,
  async timings({ text, duration, language }) {
    const words = captionTokens(text, language);
    const weight = (w) => w.length + 2 + (/[.!?。！？]$/.test(w) ? 6 : /[,;:—，、；：]$/.test(w) ? 3 : 0);
    const total = words.reduce((s, w) => s + weight(w.text), 0) || 1;
    const lead = Math.min(0.2, duration * 0.02);
    const usable = Math.max(0.5, duration - lead - 0.15);
    let t = lead;
    return {
      words: words.map((w, i) => {
        const d = (weight(w.text) / total) * usable;
        const o = { word: w.text, glue: w.glue, start: t, end: t + d };
        t += d;
        return o;
      }),
      cost: 0,
    };
  },
};
const whisperCaptions = {
  id: "openai-whisper", label: "OpenAI exact timing", cap: "captions",
  available: () => canFetch() && !!keys.get("OPENAI_API_KEY"),
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
  llm: [claudeAccountLlm, anthropicLlm, openaiLlm, geminiLlm, offlineLlm],
  voice: [elevenlabsVoice, openaiVoice, geminiVoice, noVoice],
  image: [soraVideo, openaiImage, geminiImage, pexelsImage, offlineImage],
  captions: [estimatedCaptions, whisperCaptions],
};
const down = new Map(); // circuit breaker: provider -> until
const isDown = (id) => (down.get(id) || 0) > Date.now();
/** The provider picked for each role on the Connect AI page (others are automatic backups). */
const ROLE_OF = { llm: "writer", voice: "voice", image: "visuals", captions: "captions" };
const roleChoice = (role) => loadSetting("cf-roles", {})[role];
function chain(cap, avoid = []) {
  const pick = roleChoice(ROLE_OF[cap]);
  const all = REGISTRY[cap];
  const rank = (p) => (p.id === pick ? -1 : all.indexOf(p)) + (isDown(p.id) ? 1000 : 0);
  // opt-in providers (Sora: expensive) only run when picked, never as a surprise backup
  const usable = all.filter((p) => p.available() && !avoid.includes(p.id) && (!p.optIn || p.id === pick)).sort((a, b) => rank(a) - rank(b));
  if (cap === "captions") return usable;
  // picking a free/offline option on purpose (e.g. "No voice") is respected
  if (pick && usable[0]?.id === pick && usable[0].offline) return [usable[0]];
  const online = usable.filter((p) => !p.offline);
  return online.length ? online : usable.filter((p) => p.offline);
}
const providerById = (id) => Object.values(REGISTRY).flat().find((p) => p.id === id);
const PRACTICE_IDS = new Set(["offline-writer", "no-voice", "offline-cards"]);
/** Practice mode = no real AI writer connected (voice/visuals may be free options by choice). */
function practiceMode() {
  return !REGISTRY.llm.some((p) => !p.offline && p.available());
}
