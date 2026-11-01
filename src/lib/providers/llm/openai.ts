import { key as apiKey } from "../../keys";
import { env } from "../../env";
import { httpError, ProviderError } from "../../errors";
import { tokenCost } from "../pricing";
import type { LlmProvider } from "../types";

export const openaiLlm: LlmProvider = {
  id: "openai",
  label: "OpenAI",
  capability: "llm",
  available: () => !!apiKey("OPENAI_API_KEY"),
  async complete(req) {
    const key = apiKey("OPENAI_API_KEY");
    if (!key) throw new ProviderError("missing_key", "OPENAI_API_KEY not set", { provider: "openai" });
    const model =
      req.tier === "quality" ? env().OPENAI_MODEL_QUALITY || "gpt-4.1" : env().OPENAI_MODEL_CHEAP || "gpt-4.1-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        max_completion_tokens: req.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
      }),
    });
    if (!res.ok) throw await httpError(res, "openai");
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || "";
    if (!text) throw new ProviderError("bad_output", "Empty reply from OpenAI", { provider: "openai" });
    const inputTokens = j.usage?.prompt_tokens || 0;
    const outputTokens = j.usage?.completion_tokens || 0;
    return { text, model, inputTokens, outputTokens, cost: tokenCost(model, inputTokens, outputTokens) };
  },
};
