// ---------------------------------------------------------------- any other AI service
// Most AI services speak the same "language" as OpenAI (chat completions), so one adapter covers them:
// Grok, Groq, DeepSeek, OpenRouter, Mistral, Together, Kimi, Qwen… or any address you paste.
// Added services can write scripts and power the Change-the-app chat. Their keys are saved like the rest.
const AI_PRESETS = [
  { id: "xai", name: "xAI (Grok)", base: "https://api.x.ai/v1", key: /^xai-[A-Za-z0-9]{20,}$/, prefer: [/^grok-\d+(\.\d+)?(-\d+)?$/, /^grok/], url: "https://console.x.ai" },
  { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1", key: /^gsk_[A-Za-z0-9]{20,}$/, prefer: [/gpt-oss-120b/, /llama-?4/, /llama-3\.3-70b/], url: "https://console.groq.com/keys" },
  { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", key: /^sk-or-v1-[a-f0-9]{40,}$/, prefer: [/^anthropic\/claude-sonnet/, /^openai\/gpt/, /^google\/gemini.*flash/], url: "https://openrouter.ai/keys" },
  { id: "deepseek", name: "DeepSeek", base: "https://api.deepseek.com/v1", key: /^sk-[a-f0-9]{32}$/, prefer: [/^deepseek-chat$/, /^deepseek-v\d/], url: "https://platform.deepseek.com/api_keys" },
  { id: "mistral", name: "Mistral", base: "https://api.mistral.ai/v1", prefer: [/^mistral-large-latest$/, /^mistral-medium-latest$/, /^mistral-large/], url: "https://console.mistral.ai/api-keys" },
  { id: "together", name: "Together AI", base: "https://api.together.xyz/v1", prefer: [/Llama-4/i, /Llama-3\.3-70B/i, /Qwen/], url: "https://api.together.ai/settings/api-keys" },
  { id: "moonshot", name: "Kimi (Moonshot)", base: "https://api.moonshot.ai/v1", prefer: [/^kimi-k\d/, /^kimi-latest$/, /^moonshot-v1-32k$/], url: "https://platform.moonshot.ai/console/api-keys" },
  { id: "qwen", name: "Qwen (Alibaba)", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", prefer: [/^qwen-max$/, /^qwen-plus$/, /^qwen3/], url: "https://modelstudio.console.alibabacloud.com" },
  { id: "other", name: "Other service", base: "", prefer: [] },
];
const presetById = (id) => AI_PRESETS.find((p) => p.id === id) || AI_PRESETS[AI_PRESETS.length - 1];
/** Which service a key belongs to, from its shape (only the services whose keys have a clear shape). */
const keyPreset = (v) => AI_PRESETS.find((p) => p.key && p.key.test(String(v || "").trim()))?.id || null;

const customServices = () => (loadSetting("cf-custom-ai", []) || []).filter((s) => s && s.id && s.base);
const customKey = (id) => "CUSTOM_" + id;
const SKIP_MODELS = /embed|whisper|tts|audio|image|vision-preview|guard|moderation|rerank|transcri|speech|dall|sora|realtime|search-preview|ocr/i;

/** Ask the service which models it has. Returns [] if it doesn't say (then the model can be typed in). */
async function discoverModels(base, key) {
  const res = await fetch(base.replace(/\/+$/, "") + "/models", { headers: { Authorization: `Bearer ${key}` }, signal: timeout(20000) });
  if (res.status === 401 || res.status === 403) throw new ProviderError("auth", "The service rejected that key", { provider: "custom" });
  if (!res.ok) return [];
  const j = await res.json().catch(() => ({}));
  const list = Array.isArray(j) ? j : j.data || j.models || [];
  return list.map((m) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean).filter((id) => !SKIP_MODELS.test(id));
}
function pickModel(preset, ids) {
  for (const re of presetById(preset).prefer || []) {
    const hit = ids.filter((i) => re.test(i)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (hit) return hit;
  }
  return ids[0] || "";
}

/** Add (or update) a service. Checks the key and finds a model when it can. */
async function addCustomService({ preset = "other", name, base, key, model }) {
  const p = presetById(preset);
  base = String(base || p.base || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("The service address must start with https://");
  key = String(key || "").trim();
  if (key.length < 8) throw new Error("Paste the service's API key.");
  let models = [];
  if (canFetch()) models = await discoverModels(base, key);
  model = String(model || "").trim() || pickModel(preset, models);
  if (!model) throw new Error("This service didn't list its models. Type the model name (it's on the service's website).");
  const list = customServices();
  const existing = list.find((s) => s.base === base) || list.find((s) => preset !== "other" && s.preset === preset);
  const svc = { id: existing?.id || preset + "-" + uid().slice(0, 6), preset, name: String(name || p.name).trim().slice(0, 40), base, model, models: models.slice(0, 300) };
  keys.set(customKey(svc.id), key);
  saveSetting("cf-custom-ai", [...list.filter((s) => s.id !== svc.id), svc]);
  return svc;
}
function removeCustomService(id) {
  keys.set(customKey(id), "");
  saveSetting("cf-custom-ai", customServices().filter((s) => s.id !== id));
  const roles = loadSetting("cf-roles", {});
  for (const r of Object.keys(roles)) if (roles[r] === "custom:" + id) delete roles[r];
  saveSetting("cf-roles", roles);
}
function setCustomModel(id, model) {
  saveSetting("cf-custom-ai", customServices().map((s) => (s.id === id ? { ...s, model } : s)));
}

/** The writer adapter for an added service. */
function customLlm(svc) {
  return {
    id: "custom:" + svc.id, label: svc.name, cap: "llm",
    available: () => canFetch() && !!keys.get(customKey(svc.id)),
    async complete(r) {
      const res = await fetch(svc.base + "/chat/completions", {
        method: "POST", signal: timeout(180000),
        headers: { Authorization: `Bearer ${keys.get(customKey(svc.id))}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: svc.model, max_tokens: (r.maxTokens || 1000) + 3000, // some models think first: leave room
          messages: [{ role: "system", content: r.system + "\nReply with JSON only." }, { role: "user", content: r.prompt }],
        }),
      });
      if (!res.ok) throw await httpError(res, svc.name);
      const j = await res.json();
      const text = String(j.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new ProviderError("bad_output", `Empty reply from ${svc.name}`, { provider: "custom:" + svc.id, retryable: true });
      const u = j.usage || {};
      // prices differ per service; this is a rough middle estimate for the Money page
      return { text, model: svc.model, cost: ((u.prompt_tokens || 0) * 1 + (u.completion_tokens || 0) * 4) / 1e6 };
    },
  };
}
{
  // the writer list = built-in services, then the ones you added, then the free practice writer
  const builtIn = REGISTRY.llm.filter((p) => p !== offlineLlm);
  let memo = { key: null, list: [] };
  Object.defineProperty(REGISTRY, "llm", {
    get() {
      const raw = LS.getItem("cf-custom-ai") || "[]";
      if (memo.key !== raw) memo = { key: raw, list: customServices().map(customLlm) };
      return [...builtIn, ...memo.list, offlineLlm];
    },
  });
}
