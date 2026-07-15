// Strength standards, classify a lifter Beginner -> Elite per lift the way
// https://strengthlevel.com does. The numbers are NOT approximations: they are
// the exact standards scraped from strengthlevel.com, stored in
// strength-standards.json, looked up by sex and interpolated to the athlete's
// exact bodyweight. The tables are in pounds, so e1RM and bodyweight are
// converted to pounds before lookup.
//
// WHY THIS EXISTS: a stall means different things at different levels. We turn
// the athlete's standing on the big lifts into an experience level that scales
// the readiness model (readiness.ts) and informs the AI coach (context.ts).

import rawData from "./strength-standards.json";
import type { Units } from "@/lib/types";

export type Sex = "male" | "female";

export type StrengthLevelId = "beginner" | "novice" | "intermediate" | "advanced" | "elite";

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

const LEVEL_KEYS = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"] as const;

const LB_PER_KG = 2.2046226218;
const toLb = (v: number, units: Units) => (units === "lb" ? v : v * LB_PER_KG);
const fromLb = (lb: number, units: Units) => (units === "lb" ? lb : lb / LB_PER_KG);

// ---- Load the scraped tables ----------------------------------------------

interface Bracket {
  bodyweight: number;
  [level: string]: number;
}
type Tables = { male: Bracket[]; female: Bracket[] };

interface RawLift {
  name: string;
  standards: { gender: string; bodyweight_unit: string; brackets: Bracket[] }[];
}

const LIFTS = new Map<string, Tables>();
for (const lift of (rawData as { lifts: RawLift[] }).lifts) {
  const t: Tables = { male: [], female: [] };
  for (const s of lift.standards) {
    const brackets = [...s.brackets].sort((a, b) => a.bodyweight - b.bodyweight);
    if (s.gender === "male") t.male = brackets;
    else if (s.gender === "female") t.female = brackets;
  }
  LIFTS.set(lift.name, t);
}

/** The 64 lifts we hold standards for (the file's canonical names). */
export const STANDARD_LIFTS = [...LIFTS.keys()];

// Old exercise-library names mapped to the file's canonical lift name, so
// classification works whether the database has been migrated to the file's
// names yet or not.
const ALIAS: Record<string, string> = {
  "Pull-Up": "Pull Ups",
  "Push-Up": "Push Ups",
  "EZ-Bar Curl": "EZ Bar Curl",
  "Close-Grip Bench Press": "Close Grip Bench Press",
  "T-Bar Row": "T Bar Row",
  "Chin-Up": "Chin Ups",
  "Sit-Up": "Sit Ups",
  "Diamond Push-Up": "Diamond Push Ups",
  "Barbell Bench Press": "Bench Press",
  "Barbell Back Squat": "Squat",
  "Conventional Deadlift": "Deadlift",
  "Overhead Press": "Shoulder Press",
  "Barbell Row": "Bent Over Row",
  "Trap Bar Deadlift": "Hex Bar Deadlift",
  "Skull Crusher": "Lying Tricep Extension",
  // NOTE: a plain "Bulgarian Split Squat" is deliberately NOT aliased to the
  // dumbbell table. The site keeps a separate barbell entity (total bar weight)
  // and grading a barbell lifter against per-dumbbell numbers would inflate
  // them by roughly a full band.
  // Most gyms' generic "leg press" is the 45-degree sled (3x more logged on the
  // site than the horizontal machine), so the generic name resolves there.
  "Leg Press": "Sled Leg Press",
  "Machine Chest Press": "Chest Press",
  "Hip Adduction Machine": "Hip Adduction",
  "Triceps Pushdown": "Tricep Pushdown",
  "Incline Dumbbell Press": "Incline Dumbbell Bench Press",
  "Barbell Hip Thrust": "Hip Thrust",
  "Seated Dumbbell Press": "Seated Dumbbell Shoulder Press",
  "Dip": "Dips",
  "Crunch": "Crunches",
  "Lateral Raise": "Dumbbell Lateral Raise",
  "Single-Arm Dumbbell Row": "Dumbbell Row",
  "Pec Deck": "Machine Chest Fly",
  "Standing Calf Raise": "Machine Calf Raise",

  // Future-proofing: our accessory names mapped to strengthlevel.com's
  // canonical names. These targets are not in strength-standards.json yet, so
  // resolveLift returns null for them today; the moment accessory standards are
  // ingested under the site's names, banding starts working automatically.
  "Cable Curl": "Cable Bicep Curl",
  "Concentration Curl": "Dumbbell Concentration Curl",
  "Rear Delt Fly": "Dumbbell Reverse Fly",
  "Triceps Kickback": "Dumbbell Tricep Kickback",
  "Chest-Supported Row": "Chest Supported Dumbbell Row",
  "Rope Pushdown": "Tricep Rope Pushdown",
  "Straight-Arm Pulldown": "Straight Arm Pulldown",
  "Nordic Curl": "Nordic Hamstring Curl",
  "Step-Up": "Step Up",
  "Front Raise": "Dumbbell Front Raise",
  "Overhead Triceps Extension": "Dumbbell Tricep Extension",
  "Seal Row": "Bench Pull",
  "Leg Press Calf Raise": "Sled Press Calf Raise",
  "Machine Preacher Curl": "Machine Bicep Curl",
  "Decline Dumbbell Press": "Decline Dumbbell Bench Press",
  "Stiff-Leg Deadlift": "Stiff Leg Deadlift",
  "Cable Pull-Through": "Cable Pull Through",
};

/** Resolve an exercise name (file name or old alias) to the file's lift name. */
export function resolveLift(name: string): string | null {
  if (LIFTS.has(name)) return name;
  const a = ALIAS[name];
  return a && LIFTS.has(a) ? a : null;
}

export function isStandardLift(name: string): boolean {
  return resolveLift(name) !== null;
}

// Bodyweight movements whose strengthlevel.com standards are expressed in REPS
// performed at bodyweight, not in pounds lifted (their tables read 6 / 12 / 21,
// clearly rep counts). Classifying these by Brzycki-pounds would be nonsense.
const REPS_LIFTS = new Set([
  "Pull Ups",
  "Chin Ups",
  "Neutral Grip Pull Ups",
  "Muscle Ups",
  "Push Ups",
  "Diamond Push Ups",
  "One Arm Push Ups",
  "Dips",
  "Crunches",
  "Sit Ups",
  "Bodyweight Squat",
]);

export type LiftMetric = "weight" | "reps";

/** How a lift's standard is measured: pounds of e1RM, or reps at bodyweight. */
export function liftMetric(name: string): LiftMetric | null {
  const lift = resolveLift(name);
  if (!lift) return null;
  return REPS_LIFTS.has(lift) ? "reps" : "weight";
}

// A null cell means strengthlevel shows "< 1" for that tier (common for the
// Beginner column of hard bodyweight moves) — the entry bar is effectively zero.
const cell = (b: Bracket, k: string): number => b[k] ?? 0;

// Linear interpolation of the five level thresholds at a bodyweight (lb),
// clamped to the ends of the table.
function thresholdsAt(brackets: Bracket[], bwLb: number): number[] | null {
  if (brackets.length === 0) return null;
  const first = brackets[0];
  const last = brackets[brackets.length - 1];
  if (bwLb <= first.bodyweight) return LEVEL_KEYS.map((k) => cell(first, k));
  if (bwLb >= last.bodyweight) return LEVEL_KEYS.map((k) => cell(last, k));
  for (let i = 0; i < brackets.length - 1; i++) {
    const lo = brackets[i];
    const hi = brackets[i + 1];
    if (bwLb >= lo.bodyweight && bwLb <= hi.bodyweight) {
      const t = (bwLb - lo.bodyweight) / (hi.bodyweight - lo.bodyweight);
      return LEVEL_KEYS.map((k) => cell(lo, k) + t * (cell(hi, k) - cell(lo, k)));
    }
  }
  return LEVEL_KEYS.map((k) => cell(last, k));
}

/** An athlete's best performance on a lift, in the shape standards understand. */
export interface LiftPerf {
  /** Best estimated 1RM, in the athlete's unit. Used for weight-metric lifts. */
  e1rm?: number;
  /** Most reps in a single set. Used for reps-metric (bodyweight) lifts. */
  reps?: number;
}

export interface LiftStandard {
  lift: string;
  metric: LiftMetric;
  level: StrengthLevelMeta;
  /** Weight lifts: e1RM ÷ bodyweight (2dp). Reps lifts: the rep count itself. */
  ratio: number;
  /** 0..1 progress from the current level's entry toward the next level's entry. */
  progressToNext: number;
  /**
   * Performance needed to reach the next level (null if elite): e1RM in the
   * athlete's unit for weight lifts, a rep count for reps lifts.
   */
  nextLevelValue: number | null;
  nextLevel: StrengthLevelMeta | null;
}

/**
 * Classify one lift against the exact strengthlevel.com table for the lift and
 * sex, interpolated to the athlete's bodyweight. Weight-metric lifts compare
 * e1RM in pounds; reps-metric (bodyweight) lifts compare reps in a single set.
 */
export function classifyLift(
  name: string,
  perf: LiftPerf,
  bodyweight: number,
  sex: Sex,
  units: Units,
): LiftStandard | null {
  const lift = resolveLift(name);
  if (!lift || !(bodyweight > 0)) return null;

  const metric: LiftMetric = REPS_LIFTS.has(lift) ? "reps" : "weight";
  const raw = metric === "reps" ? perf.reps : perf.e1rm;
  if (!(raw != null && raw > 0)) return null;
  // Reps compare as-is; weights convert to the table's pounds.
  const value = metric === "reps" ? raw : toLb(raw, units);

  const brackets = sex === "male" ? LIFTS.get(lift)!.male : LIFTS.get(lift)!.female;
  const bwLb = toLb(bodyweight, units);
  const thr = thresholdsAt(brackets, bwLb); // [Beginner, Novice, Intermediate, Advanced, Elite]
  if (!thr) return null;

  // Number of level thresholds cleared; level rank = max(0, cleared - 1) since
  // clearing the Beginner threshold means you ARE a Beginner.
  let cleared = 0;
  for (const t of thr) {
    if (value >= t) cleared += 1;
    else break;
  }
  const rank = Math.max(0, cleared - 1);
  const level = STRENGTH_LEVELS[rank];
  const nextLevel = rank < 4 ? STRENGTH_LEVELS[rank + 1] : null;

  const lower = thr[rank];
  const upper = rank < 4 ? thr[rank + 1] : thr[4];
  const progressToNext =
    rank >= 4 ? 1 : upper > lower ? Math.max(0, Math.min(1, (value - lower) / (upper - lower))) : 1;

  const nextRaw = nextLevel ? thr[rank + 1] : null;
  return {
    lift,
    metric,
    level,
    ratio:
      metric === "reps" ? raw : Math.round((raw / bodyweight) * 100) / 100,
    progressToNext,
    nextLevelValue:
      nextRaw == null ? null : Math.round(metric === "reps" ? nextRaw : fromLb(nextRaw, units)),
    nextLevel,
  };
}

export interface OverallStrength {
  level: StrengthLevelMeta;
  rankAvg: number;
  perLift: LiftStandard[];
}

/**
 * Roll several lifts up into one experience level: the average band across the
 * standard lifts the athlete has logged. Null when bodyweight is unknown or no
 * standard lift has been logged.
 */
export function overallStrength(
  perfByLift: Map<string, LiftPerf>,
  bodyweight: number | null | undefined,
  sex: Sex | null | undefined,
  units: Units,
): OverallStrength | null {
  if (!bodyweight || !sex) return null;

  // Resolve aliases and keep the best performance per canonical lift.
  const byFile = new Map<string, LiftPerf>();
  for (const [name, p] of perfByLift) {
    const lift = resolveLift(name);
    if (!lift) continue;
    const prev = byFile.get(lift) ?? {};
    byFile.set(lift, {
      e1rm: Math.max(prev.e1rm ?? 0, p.e1rm ?? 0),
      reps: Math.max(prev.reps ?? 0, p.reps ?? 0),
    });
  }

  const perLift: LiftStandard[] = [];
  for (const [lift, p] of byFile) {
    const c = classifyLift(lift, p, bodyweight, sex, units);
    if (c) perLift.push(c);
  }
  if (perLift.length === 0) return null;

  const rankAvg = perLift.reduce((a, c) => a + c.level.rank, 0) / perLift.length;
  const level = STRENGTH_LEVELS[Math.round(rankAvg)];
  return { level, rankAvg, perLift };
}

// --- Experience -> deload cadence -------------------------------------------

export interface DeloadCadence {
  lowWeeks: number;
  highWeeks: number;
  note: string;
}

const CADENCE: Record<StrengthLevelId, DeloadCadence> = {
  beginner: { lowWeeks: 8, highWeeks: 14, note: "rarely needs a structured deload, push and recover as needed" },
  novice: { lowWeeks: 7, highWeeks: 12, note: "a deload every ~7-9 weeks of hard training is plenty" },
  intermediate: { lowWeeks: 5, highWeeks: 9, note: "deload roughly every 4-6 weeks of hard training" },
  advanced: { lowWeeks: 4, highWeeks: 7, note: "deload roughly every 3-5 weeks of hard training" },
  elite: { lowWeeks: 3, highWeeks: 6, note: "deload often, every 3 to 4 weeks of hard training" },
};

export function cadenceFor(level: StrengthLevelId | null | undefined): DeloadCadence {
  return CADENCE[level ?? "intermediate"];
}
