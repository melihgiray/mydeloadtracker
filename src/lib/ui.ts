// Presentation helpers (NOT analytics). Maps the readiness band + deload report
// onto the visual "call" the dashboard hero shows: a verdict word, a semantic
// tone that drives the accent color, and plain dash-free copy.

import type { ReadinessReport, Tone } from "@/lib/analytics/readiness";
import type { DeloadReport } from "@/lib/analytics/deload";
import { localDateKey } from "@/lib/analytics/dates";

export type CallState = "push" | "hold" | "back-off";

export interface TodaysCall {
  state: CallState;
  tone: Tone;
  /** Big hero word. */
  verdict: string;
  /** Short state name, dash free. */
  headline: string;
  /** One plain-language line explaining the call. */
  detail: string;
}

/** hsl() string for a tone, for inline SVG/style use. */
export function toneColor(tone: Tone): string {
  const v = tone === "good" ? "--success" : tone === "caution" ? "--warning" : "--danger";
  return `hsl(var(${v}))`;
}

/** CSS variable name backing a tone, to set --accent on a container. */
export function toneAccentVar(tone: Tone): string {
  return tone === "good" ? "var(--success)" : tone === "caution" ? "var(--warning)" : "var(--danger)";
}

// ---- Consistency / streak (a derived presentation metric, not training math) ----

export interface Activity {
  /** Consecutive 7-day windows ending today that each have at least one session. */
  streakWeeks: number;
  /** Session days in the last 7 days. */
  sessionsThisWeek: number;
  /** Session-day counts for the last 8 weeks, oldest first. */
  weeklyCounts: number[];
  /** Trained-or-not for the last 14 days, oldest first. */
  last14: boolean[];
}

/**
 * Turn the set of trained day-keys into a small consistency picture. Pure
 * calendar bookkeeping, no readiness/deload logic.
 */
export function buildActivity(trainedKeys: Set<string>, now: Date): Activity {
  const keyAt = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return localDateKey(d);
  };

  const last14: boolean[] = [];
  for (let o = -13; o <= 0; o++) last14.push(trainedKeys.has(keyAt(o)));

  // Bucket the last 56 days into 8 weekly counts (index 7 = current week).
  const weeklyCounts = new Array(8).fill(0);
  for (let o = -55; o <= 0; o++) {
    if (trainedKeys.has(keyAt(o))) weeklyCounts[Math.floor((o + 55) / 7)]++;
  }

  let streakWeeks = 0;
  for (let w = 7; w >= 0; w--) {
    if (weeklyCounts[w] > 0) streakWeeks++;
    else break;
  }

  return { streakWeeks, sessionsThisWeek: weeklyCounts[7], weeklyCounts, last14 };
}

export function buildTodaysCall(readiness: ReadinessReport, deload: DeloadReport): TodaysCall {
  // A recommended deload is the strongest possible signal: it overrides the band.
  if (deload.recommended) {
    return {
      state: "back-off",
      tone: "bad",
      verdict: "Back off",
      headline: "Deload recommended",
      detail: `${deload.triggeredCount} of 3 fatigue signals are firing. Take a lighter week, then come back stronger.`,
    };
  }

  switch (readiness.band.id) {
    case "fresh":
      return {
        state: "push",
        tone: "good",
        verdict: "Push",
        headline: "Fresh and primed",
        detail: "You are well recovered. Add load on the lifts that felt easy last time.",
      };
    case "solid":
      return {
        state: "push",
        tone: "good",
        verdict: "Push",
        headline: "Recovered, keep progressing",
        detail: "Fatigue is low. Train as planned and earn load where the bar moves well.",
      };
    case "caution":
      return {
        state: "hold",
        tone: "caution",
        verdict: "Hold",
        headline: "Monitor fatigue",
        detail: "Fatigue is building. Hold your loads, chase clean reps, and watch your effort.",
      };
    default:
      return {
        state: "back-off",
        tone: "bad",
        verdict: "Back off",
        headline: "Readiness is low",
        detail: "Your fatigue markers are high. Ease off this week and let your body catch up.",
      };
  }
}
