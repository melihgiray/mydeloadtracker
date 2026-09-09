// Atomic workout persistence via the save_workout_session RPC (migration 0019,
// REST-verified applied 2026-08-12).
//
// One transaction covers create, edit, old-set deletion, and new-set insertion.
// There is deliberately NO fallback to the old split writes: a failed set
// insert used to leave an empty session, and an edit deleted the old sets before
// inserting replacements, so a rejected replacement erased the workout. The RPC
// rolls all of that back together on any failure.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanSessionContextInput, PlanSessionSnapshot } from "@/lib/plan-adherence";

/** One performed set, shaped exactly as the RPC's p_sets jsonb expects. The
 *  function fills user_id from auth.uid(), so it is never sent from the client. */
export interface SaveSetInput {
  exercise_id: string;
  set_number: number;
  reps: number;
  weight: number; // canonical kilograms
  rpe: number | null;
}

export interface SaveWorkoutInput {
  /** Present = edit that session; absent = create a new one. */
  sessionId?: string;
  performedAt: string; // ISO timestamp
  notes: string | null;
  sets: SaveSetInput[];
}

export interface SaveWorkoutArgs {
  p_session_id: string | null;
  p_performed_at: string;
  p_notes: string | null;
  p_sets: SaveSetInput[];
}

interface RecordPlanContextArgs {
  p_session_id: string;
  p_plan_id: string;
  p_plan_day_id: string;
  p_plan_snapshot: PlanSessionSnapshot;
}

/** Build the RPC argument object (pure, so it can be tested without a network). */
export function buildSaveArgs(input: SaveWorkoutInput): SaveWorkoutArgs {
  return {
    p_session_id: input.sessionId ?? null,
    p_performed_at: input.performedAt,
    p_notes: input.notes,
    p_sets: input.sets,
  };
}

/** Persist a workout and its sets atomically. Returns the session id. */
export async function saveWorkoutSession(
  supabase: SupabaseClient,
  input: SaveWorkoutInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("save_workout_session", buildSaveArgs(input));
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("Save did not return a session id.");
  return data;
}

/**
 * Attach the exact planned prescription after an atomic workout save.
 *
 * This intentionally cannot fail the workout save. Migration 0020 is applied
 * manually, so the RPC may be absent for a while after this client ships. A
 * later failure is logged for diagnosis, but throwing here would make the UI
 * retry an already-created workout and risk a duplicate session.
 */
export async function recordWorkoutPlanContext(
  supabase: SupabaseClient,
  sessionId: string,
  context: PlanSessionContextInput,
  snapshot: PlanSessionSnapshot,
): Promise<boolean> {
  const args: RecordPlanContextArgs = {
    p_session_id: sessionId,
    p_plan_id: context.planId,
    p_plan_day_id: context.planDayId,
    p_plan_snapshot: snapshot,
  };
  const { data, error } = await supabase.rpc("record_workout_plan_context", args);
  if (!error) return data === true;

  // PostgREST uses PGRST202 when a function is not in its schema cache. That is
  // the expected compatibility state before migration 0020 is applied.
  if (error.code !== "PGRST202") {
    console.error("Workout plan context save failed:", error);
  }
  return false;
}
