import { key as apiKey } from "../../keys";
import { env } from "../../env";
import { httpError, ProviderError } from "../../errors";
import { tokenCost } from "../pricing";
import type { LlmProvider } from "../types";

export const anthropicLlm: LlmProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  capability: "llm",
  available: () => !!apiKey("ANTHROPIC_API_KEY"),
  async complete(req) {
    const key = apiKey("ANTHROPIC_API_KEY");
    if (!key) throw new ProviderError("missing_key", "ANTHROPIC_API_KEY not set", { provider: "anthropic" });
    const model =
      req.tier === "quality"
        ? env().ANTHROPIC_MODEL_QUALITY || "claude-sonnet-5-5"
        : env().ANTHROPIC_MODEL_CHEAP || "claude-haiku-5-5";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        system: req.system + "\nReply with JSON only.",
        messages: [{ role: "user", content: req.prompt }],
      }),
    });
    if (!res.ok) throw await httpError(res, "anthropic");
    const j = await res.json();
    const text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (!text) throw new ProviderError("bad_output", "Empty reply from Anthropic", { provider: "anthropic" });
    const inputTokens = j.usage?.input_tokens || 0;
    const outputTokens = j.usage?.output_tokens || 0;
    return { text, model, inputTokens, outputTokens, cost: tokenCost(model, inputTokens, outputTokens) };
  },
};
