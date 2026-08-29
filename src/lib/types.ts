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

// --- Training plans (migration 0016) ---------------------------------------
// A plan says what to DO. It never records what was done, that stays in
// workout_sets, so nothing here touches history or analytics. Note there are
// no weights on a plan: prescriptions are sets and rep ranges, and the weight
// comes from the athlete's own history at log time. That keeps plans clear of
// the kg/lb seam entirely.

export type PlanGoal = "hypertrophy" | "strength" | "both";
export type PlanSplit = "ppl" | "upper_lower" | "full_body" | "arnold" | "custom";
export type PlanExerciseRole = "primary" | "secondary" | "isolation";

export interface TrainingPlan {
  id: string;
  user_id: string;
  name: string;
  goal: PlanGoal;
  split: PlanSplit;
  days_per_week: number;
  session_minutes: number | null;
  /** Equipment the athlete actually has. Empty means unconstrained. */
  equipment: string[];
  /** Injuries or movements to keep out of the plan. */
  avoid: string[];
  /** Accumulation weeks plus the deload. */
  mesocycle_weeks: number;
  /** 1-indexed week inside the mesocycle, or null if not scheduled yet. */
  deload_week: number | null;
  notes: string | null;
  active: boolean;
  started_on: string; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
  /** Migration 0017. Null until the first weekly review runs. */
  last_reviewed_on: string | null;
  /** Migration 0017. Null means the athlete was never asked. */
  training_style: string | null;
}

export interface PlanDay {
  id: string;
  plan_id: string;
  /** 0-based position in the weekly rotation, not a calendar weekday. */
  day_index: number;
  name: string; // "Push A"
  focus: string | null; // "chest, shoulders, triceps"
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
  role: PlanExerciseRole | null;
  note: string | null;
}

/** A plan day with its exercises resolved to library names, ordered. */
export interface PlanDayWithExercises extends PlanDay {
  exercises: (PlanExercise & {
    name: string;
    muscle_group: string;
    equipment: string | null;
    /** Optional so existing fixtures and edit paths that omit it still type. The
     *  live read (getActivePlan) populates it for the exercise glyphs. */
    movement_pattern?: string | null;
  })[];
}

/** The shape the Log screen and the plan view both consume. */
export interface PlanWithDays extends TrainingPlan {
  days: PlanDayWithExercises[];
}
