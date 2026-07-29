// Which brain answers: the local model, or the Anthropic API.
//
// The policy is local-first with a cloud fallback, because the founder pays
// per token for the cloud and nothing for the Mac. The fallback is what makes
// that safe, but only for the failures it can actually see:
//
//   Detectable, so the fallback works:
//     the Mac is asleep, Ollama is not running, the tunnel is down, the
//     request times out, the model returns something that fails the schema.
//
//   NOT detectable, so the fallback does nothing:
//     the local model returns a well-formed, confident, WRONG answer. A
//     scanner that reads 100 kg as 60 kg produces valid JSON and a happy
//     path, and the athlete logs bad data.
//
// So availability is covered and accuracy is not. That asymmetry is why the
// scanner needs a real gym benchmark before anyone trusts it, and it is
// written down in docs/AI_COST.md rather than left as folklore.

export type Surface = "scan" | "coach";
export type Provider = "local" | "cloud";

/**
 * Local inference is opt-in by the presence of a base URL. Production on
 * Vercel simply does not set it, so nothing there changes until a reachable
 * gateway exists and the founder sets the variable deliberately.
 */
export function localBaseUrl(): string | null {
  const raw = process.env.OLLAMA_BASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

/**
 * Per-surface override, so the scanner can be pinned back to the cloud while
 * the coach runs locally. Accepts "local" or "cloud"; anything else is
 * ignored rather than guessed at.
 */
function override(surface: Surface): Provider | null {
  const raw = (
    surface === "scan" ? process.env.AI_SCAN_PROVIDER : process.env.AI_COACH_PROVIDER
  )?.trim().toLowerCase();
  return raw === "local" || raw === "cloud" ? raw : null;
}

/** The provider to try first. */
export function preferredProvider(surface: Surface): Provider {
  const forced = override(surface);
  if (forced === "local") return "local";
  if (forced === "cloud") return "cloud";
  return localBaseUrl() ? "local" : "cloud";
}

/**
 * Whether a cloud fallback is even possible. Without a key there is nothing
 * to fall back to, and the caller should surface the local failure instead of
 * pretending a retry might help.
 */
export function cloudAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * How long to give the local model before giving up and paying for the cloud.
 *
 * The budget arithmetic matters: the scan route declares maxDuration 30s, and
 * a cloud scan measured p50 6.0s and p95 7.6s in production. Leaving 15s for
 * the local attempt keeps the worst case near 15 + 8 = 23s, inside the limit,
 * so a slow Mac degrades into a cloud answer instead of a timeout.
 *
 * Measured local latency on an M5 Pro with gemma4:12b was 8.4s to 11.2s warm
 * for ten frames and 12.7s cold, so 15s covers a warm model and deliberately
 * does NOT cover a cold load. A cold start falls back, which is the right
 * trade when someone is standing at a barbell.
 */
export const LOCAL_TIMEOUT_MS: Record<Surface, number> = {
  scan: 15_000,
  coach: 25_000,
};

export const LOCAL_MODELS: Record<Surface, string> = {
  scan: process.env.OLLAMA_SCAN_MODEL ?? "gemma4:12b",
  coach: process.env.OLLAMA_COACH_MODEL ?? "gemma4:12b",
};

/** Shared Ollama tuning, so both routes agree on context and warmth. */
export function localOptions(numPredict: number) {
  return {
    keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "10m",
    options: {
      temperature: 0,
      num_ctx: Number(process.env.OLLAMA_CONTEXT_WINDOW ?? 16384),
      num_predict: numPredict,
    },
  };
}
