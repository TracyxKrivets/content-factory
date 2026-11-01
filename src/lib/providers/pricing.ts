// Rough USD estimates for cost tracking. Edit to match your plans; unknown models fall back to defaults.
// Per 1M tokens: [input, output]
const TOKEN_PRICES: Record<string, [number, number]> = {
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1": [2, 8],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "claude-haiku-5-5": [1, 5],
  "claude-sonnet-5-5": [3, 15],
};
export function tokenCost(model: string, input: number, output: number) {
  const key = Object.keys(TOKEN_PRICES).find((k) => model.startsWith(k));
  const [i, o] = key ? TOKEN_PRICES[key] : [3, 15];
  return (input * i + output * o) / 1_000_000;
}
export const PRICE = {
  openaiTtsPerChar: 0.000015,
  elevenlabsPerChar: 0.00018,
  openaiImage: 0.063,
  whisperPerMinute: 0.006,
};
