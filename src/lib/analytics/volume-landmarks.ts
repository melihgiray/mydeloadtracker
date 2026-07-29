// Per-muscle weekly set landmarks, for the program planner.
//
// This module exists because setVolume.ts grades EVERY muscle against one
// 10 to 20 set band. That is a fine summary and a bad prescription: the weekly
// volume side delts tolerate is not the volume lower back tolerates. The
// planner needs per-muscle numbers, so it gets its own module and does not
// touch setVolume.ts (golden rule 2).
//
// THE HONESTY PROBLEM, which is the main thing this file is designed around:
//
// Every per-muscle MEV/MAV/MRV in volume-landmarks.json is graded
// `practitioner_consensus` with `confidence: low`. They come from Renaissance
// Periodization's published landmark tables, which are experienced-coach
// estimates, not trial results. The only numbers in the file with actual
// studies behind them are population-level and muscle-agnostic.
//
// So this module does three things rather than just returning numbers:
//   1. Muscles with no source return null landmarks, never a guessed number.
//   2. Every reading carries its evidence grade out to the caller.
//   3. EVIDENCE_CAVEAT is the sentence any screen showing these must display.
//
// Read docs/PLANNER_DESIGN.md first. Data: volume-landmarks.json.

import raw from "./volume-landmarks.json";

export type EvidenceGrade = "practitioner_consensus" | "no_source";
export type Confidence = "low" | "medium" | "high";

export interface SetRange {
  min: number;
  max: number;
  /** True when the source published a point value, not a range. */
  singleValue: boolean;
}

export interface MuscleLandmarks {
  muscle: string;
  /** Sets that hold current size without driving growth. */
  maintenance: SetRange | null;
  /** Minimum effective volume. */
  mev: SetRange | null;
  /** Maximum adaptive volume, a progression zone rather than a point. */
  mav: SetRange | null;
  /** Maximum recoverable volume. */
  mrv: SetRange | null;
  evidenceGrade: EvidenceGrade;
  confidence: Confidence;
  /** How many exercises in our library map to this muscle. */
  libraryDepth: number;
  sources: string[];
  /** Why the planner should treat this muscle specially, when it should. */
  plannerGuidance: string | null;
  /** The research pass's own statement of what it could not establish. */
  honestStatement: string | null;
}

/**
 * The sentence any UI showing a per-muscle landmark has to carry. These are
 * coach estimates. Presenting them beside the app's measured numbers without
 * saying so would be inventing authority the data does not have.
 */
export const EVIDENCE_CAVEAT =
  "Per-muscle set targets are experienced-coach estimates, not trial results. Treat them as a starting point, not a measurement.";

/**
 * The population-level band that DOES have studies behind it, from a
 * meta-analysis of trained men. Muscle-agnostic, so it cannot replace the
 * per-muscle table, but it is the number to prefer whenever a screen needs a
 * defensible claim.
 */
export const POPULATION_PRODUCTIVE_RANGE = {
  min: 12,
  max: 20,
  confidence: "medium" as Confidence,
  source: "bazvalle2022",
} as const;

interface RawRange {
  min: number;
  max: number;
  single_value?: boolean;
}

interface RawMuscle {
  maintenance: RawRange | null;
  mev: RawRange | null;
  mav: RawRange | null;
  mrv: RawRange | null;
  evidence_grade?: string;
  confidence?: string;
  library_depth?: number;
  source?: string[];
  planner_guidance?: string;
  honest_statement?: string;
}

const TABLE = raw.volume_landmarks as unknown as Record<string, RawMuscle>;

/** The 13 muscle groups the exercise library uses, in library-depth order. */
export const MUSCLE_GROUPS: readonly string[] = Object.keys(TABLE)
  .filter((k) => !k.startsWith("_"))
  .sort((a, b) => (TABLE[b].library_depth ?? 0) - (TABLE[a].library_depth ?? 0));

function toRange(r: RawRange | null | undefined): SetRange | null {
  if (!r || typeof r.min !== "number" || typeof r.max !== "number") return null;
  return { min: r.min, max: r.max, singleValue: r.single_value === true };
}

/** Landmarks for one muscle, or null if the name is not one of ours. */
export function landmarksFor(muscle: string): MuscleLandmarks | null {
  const d = TABLE[muscle];
  if (!d) return null;
  const grade: EvidenceGrade =
    d.evidence_grade === "practitioner_consensus" ? "practitioner_consensus" : "no_source";
  return {
    muscle,
    maintenance: toRange(d.maintenance),
    mev: toRange(d.mev),
    mav: toRange(d.mav),
    mrv: toRange(d.mrv),
    evidenceGrade: grade,
    confidence: (d.confidence as Confidence) ?? "low",
    libraryDepth: d.library_depth ?? 0,
    sources: d.source ?? [],
    plannerGuidance: d.planner_guidance ?? null,
    honestStatement: d.honest_statement ?? null,
  };
}

/**
 * Whether a generated plan should be checked against this muscle's landmarks.
 *
 * False for muscles with no source, and for muscles the library barely covers.
 * Adductors is the clear case: one exercise, no literature, and most adductor
 * stimulus arrives from squats and lunges that log elsewhere. Flagging a plan
 * for missing adductor volume would be a false positive nearly every time.
 */
export function canValidate(muscle: string): boolean {
  const l = landmarksFor(muscle);
  if (!l) return false;
  if (l.evidenceGrade === "no_source") return false;
  if (!l.mev || !l.mav) return false;
  return l.libraryDepth >= 2;
}

/**
 * The weekly set window a plan should aim for: MEV at the floor, the top of
 * MAV at the ceiling. Below the floor the muscle is only maintained, above the
 * ceiling the athlete is buying fatigue rather than growth.
 */
export function prescriptionRange(muscle: string): SetRange | null {
  const l = landmarksFor(muscle);
  if (!l?.mev || !l.mav) return null;
  return { min: l.mev.min, max: l.mav.max, singleValue: false };
}

export type VolumeZone =
  | "none"
  | "maintenance"
  | "growth"
  | "optimal"
  | "high"
  | "over_mrv";

/**
 * Where a weekly set count sits against this muscle's landmarks. Null when the
 * muscle has no landmarks, so callers must decide what to do rather than
 * receiving a made-up verdict.
 *
 * Zero is its own zone. Several muscles have a maintenance and MEV of 0 in the
 * source, meaning they get enough indirect work from compounds, and without
 * this case "no direct sets at all" would classify as growth.
 */
export function zoneFor(muscle: string, weeklySets: number): VolumeZone | null {
  const l = landmarksFor(muscle);
  if (!l?.mev || !l.mav) return null;
  if (weeklySets <= 0) return "none";
  if (weeklySets < l.mev.min) return "maintenance";
  if (weeklySets < l.mav.min) return "growth";
  if (weeklySets <= l.mav.max) return "optimal";
  if (l.mrv && weeklySets > l.mrv.max) return "over_mrv";
  return "high";
}
