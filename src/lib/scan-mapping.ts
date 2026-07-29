// Pure mapping between a vision reading and the row the scanner writes.
//
// Extracted from the scanner component so the correctness that matters can be
// tested without a camera: a scanned set must produce EXACTLY the same stored
// shape as a manually logged one (canonical kilograms, integer reps, null RPE),
// and the weight the model reads is the total on the bar, which is the same
// convention the manual form states for barbell lifts (weight-semantics.ts).

import { toKg } from "@/lib/units";
import type { Units } from "@/lib/types";

export interface ScanReading {
  detected: boolean;
  exercise?: string;
  equipment?: string;
  total_weight_kg?: number | null;
  per_side_plates_kg?: number[];
  reps?: number | null;
  confidence: "high" | "medium" | "low";
  note: string;
}

const LB_PER_KG = 2.2046226218;

/**
 * The model always reports kilograms. Convert to what the athlete reads on
 * screen: pounds snap to the nearest 5 (real plate math), kilograms to 0.1.
 */
export function readingWeightForDisplay(kg: number | null | undefined, units: Units): string {
  if (kg == null || !(kg > 0)) return "";
  const v = units === "lb" ? Math.round((kg * LB_PER_KG) / 5) * 5 : Math.round(kg * 10) / 10;
  return String(v);
}

export interface SetRow {
  reps: number;
  weight: number; // canonical kilograms
  rpe: null;
}

/**
 * Build the row to insert from what the athlete confirmed on screen. Returns
 * null when the inputs are not loggable, so the caller never writes a partial
 * set. Identical in shape and units to the manual log form's row.
 */
export function scanToSetRow(
  input: { weight: string | number; reps: string | number },
  units: Units,
): SetRow | null {
  const w = Number(input.weight);
  const r = Number(input.reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return null;
  return { reps: Math.round(r), weight: toKg(w, units), rpe: null };
}

export interface ReviewFlags {
  exercise: boolean;
  weight: boolean;
  reps: boolean;
}

/**
 * Which fields the athlete should check before saving.
 *
 * Derived only from what the model actually returned: a field is flagged when
 * the model gave nothing for it, when we could not map its exercise guess onto
 * the library, or when it reported low confidence in the whole read. We never
 * synthesise a per-field confidence number the model did not give us.
 */
export function fieldsNeedingReview(
  reading: ScanReading,
  matchedExerciseId: string,
  frameCount: number,
): ReviewFlags {
  const low = reading.confidence === "low";
  const noReps = reading.reps == null || reading.reps <= 0;
  return {
    exercise: !matchedExerciseId || low,
    weight: reading.total_weight_kg == null || !(reading.total_weight_kg > 0) || low,
    // A single still cannot show a set, so reps are always the athlete's to
    // enter there; that is expected, not a low-confidence read.
    reps: noReps || (frameCount > 1 && low),
  };
}

/**
 * One concrete retry suggestion for a read that came back thin. Returns null
 * when the read is complete enough to log as-is.
 */
export function captureHintFor(reading: ScanReading, frameCount: number): string | null {
  if (!reading.detected) return "Get the whole bar and plates in frame, filmed from the side.";
  if (reading.total_weight_kg == null || !(reading.total_weight_kg > 0)) {
    return "Move closer or add light so the plate numbers are readable.";
  }
  if (frameCount > 1 && (reading.reps == null || reading.reps <= 0)) {
    return "Film the whole set from the side so the reps are countable.";
  }
  return null;
}

/**
 * The most frames a single scan sends to the model. The client used to buffer
 * up to 16 and the route kept `slice(0, 10)`, so on a long set the extra frames
 * were compressed and uploaded for nothing, and worse, the ten the model saw
 * were the FIRST ten, covering only the opening of the set while the prompt
 * told it they spanned start to finish. One constant now, used on both sides.
 */
export const MAX_SCAN_FRAMES = 10;

/**
 * Trim a list to at most `max` items while keeping the first, the last, and an
 * even spread between them. Truncation would drop the end of the set, which is
 * where the last reps are.
 */
export function evenlySample<T>(items: T[], max = MAX_SCAN_FRAMES): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return items.slice(0, Math.max(0, max));
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}
