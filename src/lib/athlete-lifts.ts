// What the athlete says they can lift, for athletes the app has never seen.
//
// Step 3 of docs/PLANNER_V2_DESIGN.md, and the founder's second complaint: "it
// still doesn't ask me for my PR's, it still doesn't know anything about me, I
// could be a first time user trying it out."
//
// The weak-point assessment reads logged history. A new athlete has none, so
// `insufficientData` is true and they get a generic plan. Asking for a handful
// of bests fixes that on day one.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO
//
// 1. It does not write to `workout_sets`. That would be less code and would let
//    these flow through every existing analytic for free. It would also
//    fabricate training sessions that never happened, which would then appear
//    in weekly volume, readiness, deload detection and the history screen as
//    though the athlete had trained. Golden rule 4.
// 2. It does not modify `analytics/records.ts`. The merge produces a type that
//    EXTENDS PersonalRecord, so the analytics math is consumed, not edited.

import type { SupabaseClient } from "@supabase/supabase-js";
import { estimate1RM, round1 } from "@/lib/analytics/epley";
import type { PersonalRecord } from "@/lib/analytics/records";
import type { Exercise } from "@/lib/types";

/**
 * The lifts worth asking a new athlete about.
 *
 * Chosen to cover the most scoreable muscle groups per question. Of the 64
 * library lifts with published standards, these six reach six of the eleven
 * groups that can be scored at all, which is enough for assessWeakPoints to
 * produce a real median and a real lag ranking rather than giving up.
 *
 * Matched by exact library name. A name that stops resolving is dropped rather
 * than guessed at, which is why the resolver returns what it found instead of
 * assuming all six exist.
 */
export const COLD_START_LIFTS = [
  { name: "Squat", covers: "Quads" },
  { name: "Bench Press", covers: "Chest" },
  { name: "Deadlift", covers: "Back" },
  { name: "Shoulder Press", covers: "Shoulders" },
  { name: "Barbell Curl", covers: "Biceps" },
  { name: "Tricep Pushdown", covers: "Triceps" },
] as const;

export interface AthleteLift {
  exercise_id: string;
  /** In the athlete's own units, exactly as they typed it. */
  weight: number;
  reps: number;
  source: "self_reported" | "logged";
  recorded_on: string;
}

/** A record that knows whether the athlete lifted it or just claimed it. */
export interface MergedRecord extends PersonalRecord {
  source: "logged" | "self_reported";
}

/**
 * Which cold-start lifts exist in this library, with the athlete's current
 * answer if they have given one.
 *
 * Returns only lifts that resolve, so a library rename cannot produce a
 * question about an exercise that no longer exists.
 */
export function coldStartQuestions(
  library: Exercise[],
  existing: AthleteLift[],
): { exercise: Exercise; covers: string; answer: AthleteLift | null }[] {
  const byName = new Map(library.filter((e) => !e.hidden).map((e) => [e.name, e]));
  const byExerciseId = new Map(existing.map((a) => [a.exercise_id, a]));

  return COLD_START_LIFTS.flatMap((q) => {
    const exercise = byName.get(q.name);
    if (!exercise) return [];
    return [{ exercise, covers: q.covers, answer: byExerciseId.get(exercise.id) ?? null }];
  });
}

/**
 * Fold self-reported bests into records built from logged history.
 *
 * Logged history always wins where both exist. An athlete who claimed a 100 kg
 * bench and then logged 105 should be assessed on the 105, and one who claimed
 * 100 and logged 90 should still be assessed on what they actually did. The
 * claim was a starting estimate, not a standing truth.
 *
 * Pure, so the precedence rule is testable without a database.
 */
export function mergeSelfReported(
  logged: PersonalRecord[],
  lifts: AthleteLift[],
  library: Exercise[],
): MergedRecord[] {
  const byId = new Map(library.map((e) => [e.id, e]));
  const loggedIds = new Set(logged.map((r) => r.exerciseId));

  const claimed: MergedRecord[] = lifts.flatMap((lift) => {
    // Logged history for this lift means the claim is superseded.
    if (loggedIds.has(lift.exercise_id)) return [];
    const exercise = byId.get(lift.exercise_id);
    if (!exercise) return [];

    const e1rm = round1(estimate1RM(lift.weight, lift.reps));
    return [
      {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        muscleGroup: exercise.muscle_group,
        isMajor: exercise.is_major,
        maxWeight: lift.weight,
        bestE1RM: e1rm,
        bestE1RMWeight: lift.weight,
        bestE1RMReps: lift.reps,
        bestReps: lift.reps,
        achievedAt: lift.recorded_on,
        source: "self_reported",
      },
    ];
  });

  return [...logged.map((r) => ({ ...r, source: "logged" as const })), ...claimed];
}

/** The athlete's self-reported bests. */
export async function getAthleteLifts(supabase: SupabaseClient): Promise<AthleteLift[]> {
  const { data, error } = await supabase
    .from("athlete_lifts")
    .select("exercise_id, weight, reps, source, recorded_on");
  if (error) throw error;
  return ((data ?? []) as { weight: number | string; [k: string]: unknown }[]).map((r) => ({
    ...(r as unknown as AthleteLift),
    // numeric(6,2) arrives as a string over PostgREST.
    weight: Number(r.weight),
  }));
}

export interface LiftClaim {
  exerciseId: string;
  weight: number;
  reps: number;
}

/**
 * Save the athlete's answers, replacing any previous claim for the same lift.
 *
 * Blank answers are simply absent from `claims`. Skipping is a first-class
 * answer and must not write a zero, which would read as "I can lift nothing"
 * rather than "I would rather not say".
 */
export async function saveAthleteLifts(
  supabase: SupabaseClient,
  claims: LiftClaim[],
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  if (claims.length === 0) return;

  const { error } = await supabase.from("athlete_lifts").upsert(
    claims.map((c) => ({
      user_id: user.id,
      exercise_id: c.exerciseId,
      weight: c.weight,
      reps: c.reps,
      source: "self_reported",
    })),
    { onConflict: "user_id,exercise_id" },
  );
  if (error) throw error;
}
