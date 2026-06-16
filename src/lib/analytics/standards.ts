// Strength standards — classify a lifter Beginner → Elite per lift, the way
// https://strengthlevel.com does, from the ratio of estimated 1RM to bodyweight.
//
// WHY THIS EXISTS: a stall on a lift means very different things at different
// experience levels. A novice who stalls usually just needs to eat/sleep/keep
// pushing; an advanced lifter who stalls is far likelier to be accumulating
// fatigue that a deload fixes. Coaching consensus: intermediates deload every
// 4-6 weeks of hard training, advanced lifters every 3-5, while novices rarely
// need a structured deload. We turn the athlete's standing on the big lifts into
// an experience level and feed that into the readiness model (see readiness.ts)
// and the AI coach (context.ts).
//
// The bodyweight-multiple thresholds below are population approximations in the
// spirit of StrengthLevel's tables (which are built from tens of millions of
// logged lifts). They're intentionally coarse 5-bucket bands, not a claim of
// per-kilo precision. Everything is a ratio of two same-unit weights (e1RM ÷
// bodyweight), so the module is unit-agnostic: as long as the bodyweight is in
// the same unit the athlete logs lifts in (kg or lb), the bands are correct.
//
// This module has no imports so it stays a pure, independently-testable step.

export type Sex = "male" | "female";

export type StrengthLevelId =
  | "beginner"
  | "novice"
  | "intermediate"
  | "advanced"
  | "elite";

export interface StrengthLevelMeta {
  id: StrengthLevelId;
  label: string;
  rank: number; // 0 (beginner) .. 4 (elite)
}

export const STRENGTH_LEVELS: StrengthLevelMeta[] = [
  { id: "beginner", label: "Beginner", rank: 0 },
  { id: "novice", label: "Novice", rank: 1 },
  { id: "intermediate", label: "Intermediate", rank: 2 },
  { id: "advanced", label: "Advanced", rank: 3 },
  { id: "elite", label: "Elite", rank: 4 },
];

// Canonical lifts we hold standards for, keyed by the exact `name` used in the
// seeded exercise library so we can match by name without an extra column. We
// only band barbell / cleanly-loaded movements where the logged weight is
// unambiguous — dumbbell and high-variance machine lifts are deliberately left
// out so we never mis-band someone on a per-dumbbell vs total-load mixup.
export const STANDARD_LIFTS = [
  "Barbell Back Squat",
  "Barbell Bench Press",
  "Conventional Deadlift",
  "Overhead Press",
  "Barbell Row",
  "Front Squat",
  "Incline Bench Press",
  "Close-Grip Bench Press",
  "Romanian Deadlift",
  "Trap Bar Deadlift",
  "Barbell Hip Thrust",
  "Pendlay Row",
  "Power Clean",
  "Push Press",
] as const;

export type StandardLiftName = (typeof STANDARD_LIFTS)[number];

// Bodyweight multiples (e1RM ÷ bodyweight) required to ENTER each level, in the
// order [novice, intermediate, advanced, elite]. Below the first value = beginner.
// Calibrated near StrengthLevel's male ~90kg / female ~60kg reference lifters.
const RATIOS: Record<StandardLiftName, Record<Sex, [number, number, number, number]>> = {
  "Barbell Back Squat": { male: [1.0, 1.5, 2.0, 2.5], female: [0.75, 1.15, 1.6, 2.05] },
  "Barbell Bench Press": { male: [0.75, 1.1, 1.5, 1.9], female: [0.5, 0.75, 1.0, 1.3] },
  "Conventional Deadlift": { male: [1.25, 1.75, 2.25, 2.75], female: [0.95, 1.35, 1.8, 2.3] },
  "Overhead Press": { male: [0.5, 0.7, 0.9, 1.1], female: [0.35, 0.5, 0.7, 0.9] },
  "Barbell Row": { male: [0.65, 0.9, 1.2, 1.5], female: [0.45, 0.65, 0.85, 1.1] },
  "Front Squat": { male: [0.8, 1.15, 1.5, 1.9], female: [0.6, 0.9, 1.2, 1.55] },
  "Incline Bench Press": { male: [0.6, 0.9, 1.25, 1.6], female: [0.4, 0.6, 0.85, 1.1] },
  "Close-Grip Bench Press": { male: [0.6, 0.9, 1.25, 1.6], female: [0.4, 0.6, 0.85, 1.1] },
  "Romanian Deadlift": { male: [0.9, 1.4, 1.9, 2.4], female: [0.65, 1.0, 1.4, 1.85] },
  "Trap Bar Deadlift": { male: [1.3, 1.85, 2.4, 2.95], female: [1.0, 1.45, 1.9, 2.45] },
  "Barbell Hip Thrust": { male: [1.25, 1.85, 2.5, 3.2], female: [1.0, 1.5, 2.1, 2.7] },
  "Pendlay Row": { male: [0.6, 0.85, 1.15, 1.45], female: [0.4, 0.6, 0.8, 1.05] },
  "Power Clean": { male: [0.75, 1.1, 1.4, 1.75], female: [0.5, 0.75, 1.0, 1.3] },
  "Push Press": { male: [0.65, 0.9, 1.15, 1.45], female: [0.45, 0.65, 0.85, 1.1] },
};

export function isStandardLift(name: string): name is StandardLiftName {
  return (STANDARD_LIFTS as readonly string[]).includes(name);
}

export interface LiftStandard {
  lift: StandardLiftName;
  level: StrengthLevelMeta;
  ratio: number; // e1RM / bodyweight (rounded to 2dp)
  /** 0..1 progress from the current level's entry toward the next level's entry. */
  progressToNext: number;
  /** e1RM needed to reach the next level (null if already elite). */
  nextLevelE1RM: number | null;
  nextLevel: StrengthLevelMeta | null;
}

/**
 * Classify one lift from an estimated 1RM and the athlete's bodyweight. The
 * e1RM and bodyweight must be in the same unit (kg or lb); the result is a
 * unit-agnostic ratio band.
 */
export function classifyLift(
  lift: StandardLiftName,
  e1rm: number,
  bodyweight: number,
  sex: Sex,
): LiftStandard | null {
  if (!(e1rm > 0) || !(bodyweight > 0)) return null;

  // Entry e1RM for each level = bodyweight-multiple × bodyweight.
  const thresholds = RATIOS[lift][sex].map((r) => r * bodyweight); // [nov, int, adv, eli]
  const ratio = e1rm / bodyweight;

  // rank = number of thresholds cleared (0 => beginner .. 4 => elite)
  let rank = 0;
  for (const t of thresholds) {
    if (e1rm >= t) rank += 1;
    else break;
  }

  const level = STRENGTH_LEVELS[rank];
  const nextLevel = rank < 4 ? STRENGTH_LEVELS[rank + 1] : null;

  // Lower/upper e1RM bounds of the current band for the progress bar.
  const lower = rank === 0 ? 0 : thresholds[rank - 1];
  const upper = rank < 4 ? thresholds[rank] : thresholds[3];
  const progressToNext =
    rank >= 4 ? 1 : upper > lower ? Math.max(0, Math.min(1, (e1rm - lower) / (upper - lower))) : 1;

  return {
    lift,
    level,
    ratio: Math.round(ratio * 100) / 100,
    progressToNext,
    nextLevelE1RM: nextLevel ? Math.round(thresholds[rank]) : null,
    nextLevel,
  };
}

export interface OverallStrength {
  level: StrengthLevelMeta;
  /** Average rank across classified lifts (0..4, fractional). */
  rankAvg: number;
  perLift: LiftStandard[];
}

/**
 * Roll several lifts up into one experience level — the average band across
 * whatever standard lifts the athlete has data for. Returns null when bodyweight
 * is unknown or no standard lift has been logged.
 */
export function overallStrength(
  e1rmByLift: Map<string, number>,
  bodyweight: number | null | undefined,
  sex: Sex | null | undefined,
): OverallStrength | null {
  if (!bodyweight || !sex) return null;

  const perLift: LiftStandard[] = [];
  for (const lift of STANDARD_LIFTS) {
    const e = e1rmByLift.get(lift);
    if (!e) continue;
    const c = classifyLift(lift, e, bodyweight, sex);
    if (c) perLift.push(c);
  }
  if (perLift.length === 0) return null;

  const rankAvg = perLift.reduce((a, c) => a + c.level.rank, 0) / perLift.length;
  const level = STRENGTH_LEVELS[Math.round(rankAvg)];
  return { level, rankAvg, perLift };
}

// --- Experience → deload cadence -------------------------------------------
// Maps an experience level to how long an athlete can stack hard weeks before a
// deload is warranted. Used by readiness.ts to scale the "weeks of hard
// training" fatigue ramp: novices get a long runway, elites a short one. This is
// the algorithmic payoff of knowing the athlete's level.

export interface DeloadCadence {
  /** Hard-week count at which fatigue from time-under-load starts to count. */
  lowWeeks: number;
  /** Hard-week count at which that fatigue maxes out. */
  highWeeks: number;
  /** Plain-language cadence guidance, e.g. "every 4-6 weeks". */
  note: string;
}

const CADENCE: Record<StrengthLevelId, DeloadCadence> = {
  beginner: { lowWeeks: 8, highWeeks: 14, note: "rarely needs a structured deload, push and recover as needed" },
  novice: { lowWeeks: 7, highWeeks: 12, note: "a deload every ~7-9 weeks of hard training is plenty" },
  intermediate: { lowWeeks: 5, highWeeks: 9, note: "deload roughly every 4-6 weeks of hard training" },
  advanced: { lowWeeks: 4, highWeeks: 7, note: "deload roughly every 3-5 weeks of hard training" },
  elite: { lowWeeks: 3, highWeeks: 6, note: "deload often, every 3 to 4 weeks of hard training" },
};

/** Deload cadence for a level; defaults to intermediate when level is unknown. */
export function cadenceFor(level: StrengthLevelId | null | undefined): DeloadCadence {
  return CADENCE[level ?? "intermediate"];
}
