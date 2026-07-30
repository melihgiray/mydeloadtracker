// Which Claude model each AI route uses.
//
// These were previously one shared ANTHROPIC_MODEL variable, which meant the
// scanner and the coach could not be priced independently. They have very
// different cost profiles, so they get their own knobs:
//
//   - The scanner is dominated by IMAGE tokens (a recorded set sends 8 to 16
//     frames), and its job is a constrained extraction into a forced tool.
//     That is the kind of work a cheaper model does well.
//   - The coach reasons over eight weeks of training history in prose. It is
//     the quality-sensitive one, and it is already prompt-cached.
//
// Both fall back to ANTHROPIC_MODEL and then to the previous default, so
// nothing changes until an env var is deliberately set.
//
// Pricing per million tokens, for the arithmetic in docs/AI_COST.md:
//   claude-sonnet-4-6  $3 in  / $15 out
//   claude-haiku-4-5   $1 in  / $5  out   (3x cheaper)

const FALLBACK = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

/** Vision plus forced tool use. Cost here is mostly image tokens. */
export const SCAN_MODEL = process.env.ANTHROPIC_SCAN_MODEL ?? FALLBACK;

/** Long-context reasoning over training history. Quality-sensitive. */
export const COACH_MODEL = process.env.ANTHROPIC_COACH_MODEL ?? FALLBACK;

/**
 * One shot structured generation of a whole training plan.
 *
 * Separate from the coach because it is the only call in the app bounded by a
 * hard wall clock: the Vercel account is on Hobby, where 60s per function
 * cannot be raised, and a plan that generates too slowly returns nothing at
 * all. That makes speed a correctness property here and merely nice elsewhere,
 * so it needs its own knob. Falls back to the coach model.
 */
export const PLAN_MODEL = process.env.ANTHROPIC_PLAN_MODEL ?? COACH_MODEL;

/** Token usage returned by the Anthropic SDK, narrowed to what we report. */
export interface UsageReport {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Normalise an SDK usage object for logging. Reported to PostHog so cost is
 * measured from real traffic rather than estimated, which is the only way to
 * tell whether a model or frame-count change actually paid off.
 */
export function toUsageReport(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null | undefined,
): UsageReport {
  return {
    model,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}
