// Atomic workout persistence via the save_workout_session RPC (migration 0019,
// REST-verified applied 2026-08-12).
//
// One transaction covers create, edit, old-set deletion, and new-set insertion.
// There is deliberately NO fallback to the old split writes: a failed set
// insert used to leave an empty session, and an edit deleted the old sets before
// inserting replacements, so a rejected replacement erased the workout. The RPC
// rolls all of that back together on any failure.

import type { SupabaseClient } from "@supabase/supabase-js";

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
