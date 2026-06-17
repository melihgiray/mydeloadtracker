// Server-side data access. Fetches a user's training data and maps it into the
// flat TrainingSet shape consumed by the analytics layer.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyCheckin, Exercise, Profile, TrainingSet, Units } from "@/lib/types";
import { localDateKey } from "@/lib/analytics/dates";
import { fromKg } from "@/lib/units";

function isoWeeksAgo(weeks: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - weeks * 7);
  return d.toISOString();
}

/** Raw row shape returned by the embedded select below. */
interface SetRow {
  reps: number;
  weight: number;
  rpe: number | null;
  set_number: number;
  workout_sessions: { id: string; performed_at: string } | null;
  exercises: { id: string; name: string; muscle_group: string; is_major: boolean } | null;
}

export async function getTrainingSets(
  supabase: SupabaseClient,
  units: Units,
  weeks: number = 8,
  now: Date = new Date(),
): Promise<TrainingSet[]> {
  const since = isoWeeksAgo(weeks, now);

  const { data, error } = await supabase
    .from("workout_sets")
    .select(
      "reps, weight, rpe, set_number, workout_sessions!inner(id, performed_at), exercises!inner(id, name, muscle_group, is_major)",
    )
    .gte("workout_sessions.performed_at", since)
    .order("performed_at", { foreignTable: "workout_sessions", ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as unknown as SetRow[];
  return rows
    .filter((r) => r.workout_sessions && r.exercises)
    .map((r) => ({
      date: r.workout_sessions!.performed_at,
      sessionId: r.workout_sessions!.id,
      exerciseId: r.exercises!.id,
      exerciseName: r.exercises!.name,
      muscleGroup: r.exercises!.muscle_group,
      isMajor: r.exercises!.is_major,
      reps: r.reps,
      weight: fromKg(Number(r.weight), units),
      rpe: r.rpe != null ? Number(r.rpe) : null,
    }));
}

export async function getExercises(supabase: SupabaseClient): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .order("muscle_group", { ascending: true })
    .order("is_major", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

export async function getProfile(supabase: SupabaseClient): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").single();
  if (error) return null;
  const profile = data as Profile;
  // Bodyweight is stored in kg; present it in the athlete's display unit so the
  // rest of the app can treat profile.bodyweight as already-in-display-units.
  if (profile.bodyweight != null) {
    profile.bodyweight = fromKg(profile.bodyweight, profile.units);
  }
  return profile;
}

/** Recent daily check-ins (newest first). Returns [] if the table is absent. */
export async function getCheckins(
  supabase: SupabaseClient,
  days: number = 14,
  now: Date = new Date(),
): Promise<DailyCheckin[]> {
  const since = new Date(now);
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from("daily_checkins")
    .select("*")
    .gte("date", localDateKey(since))
    .order("date", { ascending: false });
  if (error) return []; // table may not exist yet (migration 0003 not applied)
  return (data ?? []) as DailyCheckin[];
}

/** Connection status for a wearable provider (no tokens exposed). */
export async function getWearableStatus(
  supabase: SupabaseClient,
  provider: string,
): Promise<{ connected: boolean; lastSync: string | null }> {
  const { data, error } = await supabase
    .from("wearable_connections")
    .select("updated_at")
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return { connected: false, lastSync: null };
  return { connected: true, lastSync: (data as { updated_at: string }).updated_at };
}

/** A session joined with its sets and each set's exercise, for history/editing. */
export interface SessionWithSets {
  id: string;
  performed_at: string;
  notes: string | null;
  sets: {
    id: string;
    reps: number;
    weight: number;
    rpe: number | null;
    set_number: number;
    exerciseId: string;
    exerciseName: string;
    muscleGroup: string;
    movementPattern: string | null;
    isMajor: boolean;
  }[];
}

interface SessionRow {
  id: string;
  performed_at: string;
  notes: string | null;
  workout_sets:
    | {
        id: string;
        reps: number;
        weight: number;
        rpe: number | null;
        set_number: number;
        exercises: {
          id: string;
          name: string;
          muscle_group: string;
          movement_pattern: string | null;
          is_major: boolean;
        } | null;
      }[]
    | null;
}

export async function getSessionsWithSets(
  supabase: SupabaseClient,
  units: Units,
  limit: number = 50,
): Promise<SessionWithSets[]> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(
      "id, performed_at, notes, workout_sets(id, reps, weight, rpe, set_number, exercises(id, name, muscle_group, movement_pattern, is_major))",
    )
    .order("performed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as unknown as SessionRow[];
  return rows.map((r) => ({
    id: r.id,
    performed_at: r.performed_at,
    notes: r.notes,
    sets: (r.workout_sets ?? [])
      .filter((s) => s.exercises)
      .sort((a, b) => a.set_number - b.set_number)
      .map((s) => ({
        id: s.id,
        reps: s.reps,
        weight: fromKg(Number(s.weight), units),
        rpe: s.rpe != null ? Number(s.rpe) : null,
        set_number: s.set_number,
        exerciseId: s.exercises!.id,
        exerciseName: s.exercises!.name,
        muscleGroup: s.exercises!.muscle_group,
        movementPattern: s.exercises!.movement_pattern,
        isMajor: s.exercises!.is_major,
      })),
  }));
}

export async function getSessionWithSets(
  supabase: SupabaseClient,
  units: Units,
  sessionId: string,
): Promise<SessionWithSets | null> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(
      "id, performed_at, notes, workout_sets(id, reps, weight, rpe, set_number, exercises(id, name, muscle_group, movement_pattern, is_major))",
    )
    .eq("id", sessionId)
    .single();
  if (error || !data) return null;

  const r = data as unknown as SessionRow;
  return {
    id: r.id,
    performed_at: r.performed_at,
    notes: r.notes,
    sets: (r.workout_sets ?? [])
      .filter((s) => s.exercises)
      .sort((a, b) => a.set_number - b.set_number)
      .map((s) => ({
        id: s.id,
        reps: s.reps,
        weight: fromKg(Number(s.weight), units),
        rpe: s.rpe != null ? Number(s.rpe) : null,
        set_number: s.set_number,
        exerciseId: s.exercises!.id,
        exerciseName: s.exercises!.name,
        muscleGroup: s.exercises!.muscle_group,
        movementPattern: s.exercises!.movement_pattern,
        isMajor: s.exercises!.is_major,
      })),
  };
}
