// Shared domain types used across the app and analytics layer.

export type Units = "kg" | "lb";
export type Sex = "male" | "female";

export interface Profile {
  id: string;
  full_name: string | null;
  units: Units;
  /** Bodyweight in the athlete's logging unit, for strength-standard banding. Null until set. */
  bodyweight: number | null;
  /** Biological sex for strength standards. Null until set. */
  sex: Sex | null;
  created_at: string;
  updated_at: string;
}

export interface Exercise {
  id: string;
  user_id: string | null;
  name: string;
  muscle_group: string;
  movement_pattern: string | null;
  equipment: string | null;
  is_major: boolean;
  /** Retired from the picker by the standards-library migration, kept for history. */
  hidden?: boolean;
  created_at: string;
}

export interface WorkoutSession {
  id: string;
  user_id: string;
  performed_at: string;
  notes: string | null;
  duration_minutes: number | null;
  created_at: string;
}

export interface WorkoutSet {
  id: string;
  session_id: string;
  exercise_id: string;
  user_id: string;
  set_number: number;
  reps: number;
  weight: number;
  rpe: number | null;
  created_at: string;
}

export interface TrainingPlan {
  id: string;
  user_id: string;
  name: string;
  goal: string;
  split: string;
  days_per_week: number;
  session_minutes: number | null;
  equipment: string[];
  avoid: string[];
  mesocycle_weeks: number;
  deload_week: number | null;
  notes: string | null;
  active: boolean;
  started_on: string;
  created_at: string;
  updated_at: string;
}

export interface PlanDay {
  id: string;
  plan_id: string;
  day_index: number;
  name: string;
  focus: string | null;
}

export interface PlanExercise {
  id: string;
  plan_day_id: string;
  exercise_id: string;
  position: number;
  sets: number;
  rep_low: number;
  rep_high: number;
  rpe_target: number | null;
  rest_seconds: number | null;
  role: string | null;
  note: string | null;
}

/**
 * A single logged set flattened with the metadata the analytics layer needs.
 * This is the canonical input shape for every function in lib/analytics.
 */
export interface TrainingSet {
  date: string; // ISO timestamp of the session it belongs to
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  isMajor: boolean;
  reps: number;
  weight: number;
  rpe: number | null;
}

export interface DailyCheckin {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  sleep_quality: number | null; // 1-5, higher better
  soreness: number | null; // 1-5, higher worse
  motivation: number | null; // 1-5, higher better
  energy: number | null; // 1-5, higher better
  /** Resting heart rate (bpm), from a wearable or manual. Higher vs baseline = under-recovery. */
  resting_hr: number | null;
  /** Heart-rate variability (ms, e.g. RMSSD). Lower vs baseline = under-recovery. */
  hrv: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProgressStatus = "progressing" | "plateauing" | "regressing" | "insufficient";
