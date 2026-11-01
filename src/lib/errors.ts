import type { ErrorCode, FriendlyError, StepName } from "./types";

export class ProviderError extends Error {
  code: ErrorCode;
  retryable: boolean;
  provider?: string;
  constructor(code: ErrorCode, message: string, opts: { retryable?: boolean; provider?: string } = {}) {
    super(message);
    this.code = code;
    this.retryable = opts.retryable ?? ["rate_limit", "timeout", "network"].includes(code);
    this.provider = opts.provider;
  }
}

/** Turn an HTTP failure into a classified ProviderError. */
export async function httpError(res: Response, provider: string): Promise<ProviderError> {
  const body = (await res.text().catch(() => "")).slice(0, 600);
  const b = body.toLowerCase();
  const msg = `${provider} HTTP ${res.status}: ${body}`;
  if (res.status === 401 || res.status === 403) return new ProviderError("auth", msg, { provider });
  if (res.status === 402 || /quota|insufficient|credit|billing|exceeded your/.test(b))
    return new ProviderError("quota", msg, { provider });
  if (res.status === 429) return new ProviderError("rate_limit", msg, { provider });
  if (/safety|content_policy|moderation|policy_violation|not allowed|blocked/.test(b))
    return new ProviderError("content_blocked", msg, { provider });
  if (res.status === 408 || res.status === 504) return new ProviderError("timeout", msg, { provider });
  if (res.status >= 500) return new ProviderError("network", msg, { provider, retryable: true });
  return new ProviderError("unknown", msg, { provider });
}

export function toProviderError(e: unknown, provider?: string): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as any;
  const m = String(err?.message || err);
  if (err?.code === "missing_asset") return new ProviderError("missing_asset", m, { provider });
  if (err?.name === "AbortError" || /timed? ?out/i.test(m)) return new ProviderError("timeout", m, { provider });
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(m)) return new ProviderError("network", m, { provider });
  if (/JSON/i.test(m)) return new ProviderError("bad_output", m, { provider, retryable: true });
  return new ProviderError("unknown", m, { provider });
}

const WHO: Record<string, string> = {
  script: "The writer",
  script_check: "The script checker",
  scenes: "The scene planner",
  ideas: "The idea maker",
  voice: "The voice generator",
  visuals: "The image generator",
  music: "The music maker",
  captions: "The caption maker",
  assemble: "The video editor",
  final_check: "The final check",
  system: "The app",
};

const OPTIONAL: string[] = ["script_check", "music", "captions", "final_check"];

export function friendly(e: unknown, step: StepName | "ideas" | "system"): FriendlyError {
  const pe = toProviderError(e);
  const who = WHO[step] || "Something";
  const t: Record<ErrorCode, [string, string]> = {
    missing_key: [`${who} isn't connected.`, "Add its API key on the server, or use the backup."],
    auth: [`${who} rejected the API key.`, "Check the key is correct and active, or use the backup."],
    rate_limit: [`${who} is busy.`, "Wait a minute and try again, or use the backup."],
    quota: [`${who} is out of credits.`, "Top up that account, or use the backup."],
    timeout: [`${who} took too long.`, "Try again."],
    network: [`Couldn't reach ${who.toLowerCase().replace(/^the /, "the ")}.`, "Check the internet connection and try again."],
    bad_output: [`${who} gave a weird answer.`, "Try again. It usually works the second time."],
    content_blocked: [`${who} refused this content.`, "Use the backup, or make the request a bit less graphic."],
    render_failed: ["The video editor couldn't put the video together.", "Try again. If it keeps failing, redo the visuals."],
    missing_asset: ["A file this step needs went missing.", "Redo the part that made it (voice or visuals)."],
    quality_failed: [`${who}'s result didn't pass the quality check.`, "Try again for a fresh version."],
    unknown: [`Something went wrong with ${who.toLowerCase()}.`, "Try again. Details are under Advanced."],
  };
  const [message, suggestion] = t[pe.code];
  return {
    code: pe.code,
    message,
    suggestion,
    technical: pe.message.slice(0, 2000),
    canSkip: OPTIONAL.includes(step),
    canBackup: ["script", "script_check", "scenes", "ideas", "voice", "visuals", "captions", "music"].includes(step),
    provider: pe.provider,
    at: new Date().toISOString(),
  };
}
