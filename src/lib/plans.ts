import type { SupabaseClient } from "@supabase/supabase-js";
import type { Exercise, PlanDay, PlanExercise, TrainingPlan } from "@/lib/types";

export interface PlanExerciseWithExercise extends PlanExercise {
  exercise: Exercise;
}

export interface PlanDayWithExercises extends PlanDay {
  exercises: PlanExerciseWithExercise[];
}

export interface ActiveTrainingPlan extends TrainingPlan {
  days: PlanDayWithExercises[];
}

export interface CreatePlanExercise {
  exercise_id: string;
  sets: number;
  rep_low: number;
  rep_high: number;
  rpe_target?: number | null;
  rest_seconds?: number | null;
  role?: string | null;
  note?: string | null;
}

export interface CreatePlanDay {
  name: string;
  focus?: string | null;
  exercises: CreatePlanExercise[];
}

export interface CreatePlanInput {
  name: string;
  goal: string;
  split: string;
  days_per_week: number;
  session_minutes?: number | null;
  equipment?: string[];
  avoid?: string[];
  mesocycle_weeks?: number;
  deload_week?: number | null;
  notes?: string | null;
  started_on?: string;
  days: CreatePlanDay[];
}

interface ActivePlanRow extends TrainingPlan {
  plan_days:
    | (PlanDay & {
        plan_exercises:
          | (PlanExercise & {
              exercise: Exercise | null;
            })[]
          | null;
      })[]
    | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validatePlanInput(plan: CreatePlanInput): void {
  if (plan.days.length !== plan.days_per_week) {
    throw new Error("Plan day count must match days_per_week");
  }
  if (plan.days.length === 0 || plan.days.some((day) => day.exercises.length === 0)) {
    throw new Error("A plan and each plan day must contain at least one exercise");
  }
}

export async function getActivePlan(
  supabase: SupabaseClient,
): Promise<ActiveTrainingPlan | null> {
  const { data, error } = await supabase
    .from("training_plans")
    .select(
      "*, plan_days(*, plan_exercises(*, exercise:exercises(*)))",
    )
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as ActivePlanRow;
  const days = (row.plan_days ?? [])
    .slice()
    .sort((a, b) => a.day_index - b.day_index)
    .map(({ plan_exercises, ...day }) => ({
      ...day,
      exercises: (plan_exercises ?? [])
        .filter(
          (exercise): exercise is PlanExercise & { exercise: Exercise } =>
            exercise.exercise != null,
        )
        .slice()
        .sort((a, b) => a.position - b.position),
    }));
  const { plan_days: _planDays, ...plan } = row;

  return { ...plan, days };
}

export async function getPlanDayForToday(
  supabase: SupabaseClient,
): Promise<PlanDayWithExercises | null> {
  const plan = await getActivePlan(supabase);
  if (!plan || plan.days.length === 0) return null;

  // A session has no plan_day_id yet. Counting distinct training dates since
  // this plan started is the only durable rotation signal in the current
  // schema. Missed calendar days therefore do not advance the rotation, while
  // duplicate session rows on one date advance it only once.
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("performed_at")
    .gte("performed_at", `${plan.started_on}T00:00:00.000Z`)
    .order("performed_at", { ascending: true });

  if (error) throw error;

  const loggedDates = new Set(
    ((data ?? []) as { performed_at: string }[]).map((session) =>
      session.performed_at.slice(0, 10),
    ),
  );

  return plan.days[loggedDates.size % plan.days.length];
}

async function restoreActivePlans(
  supabase: SupabaseClient,
  planIds: string[],
): Promise<string | null> {
  if (planIds.length === 0) return null;
  const { error } = await supabase
    .from("training_plans")
    .update({ active: true })
    .in("id", planIds);
  return error ? errorMessage(error) : null;
}

export async function createPlan(
  supabase: SupabaseClient,
  plan: CreatePlanInput,
): Promise<TrainingPlan> {
  validatePlanInput(plan);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("An authenticated user is required to create a plan");

  const { data: deactivatedRows, error: deactivateError } = await supabase
    .from("training_plans")
    .update({ active: false })
    .eq("active", true)
    .select("id");
  if (deactivateError) throw deactivateError;

  const previousPlanIds = ((deactivatedRows ?? []) as { id: string }[]).map(
    ({ id }) => id,
  );
  let createdPlanId: string | null = null;

  try {
    const { days, ...planFields } = plan;
    const { data: createdPlan, error: planError } = await supabase
      .from("training_plans")
      .insert({
        ...planFields,
        session_minutes: plan.session_minutes ?? null,
        equipment: plan.equipment ?? [],
        avoid: plan.avoid ?? [],
        mesocycle_weeks: plan.mesocycle_weeks ?? 5,
        deload_week: plan.deload_week ?? null,
        notes: plan.notes ?? null,
        user_id: authData.user.id,
        active: true,
      })
      .select("*")
      .single();
    if (planError) throw planError;

    const trainingPlan = createdPlan as TrainingPlan;
    createdPlanId = trainingPlan.id;

    const { data: createdDays, error: daysError } = await supabase
      .from("plan_days")
      .insert(
        days.map((day, dayIndex) => ({
          plan_id: trainingPlan.id,
          day_index: dayIndex,
          name: day.name,
          focus: day.focus ?? null,
        })),
      )
      .select("*");
    if (daysError) throw daysError;

    const dayRows = (createdDays ?? []) as PlanDay[];
    const dayIdByIndex = new Map(dayRows.map((day) => [day.day_index, day.id]));
    if (dayIdByIndex.size !== days.length) {
      throw new Error("Database did not return every inserted plan day");
    }

    const exerciseRows = days.flatMap((day, dayIndex) => {
      const planDayId = dayIdByIndex.get(dayIndex);
      if (!planDayId) throw new Error(`Missing inserted plan day at index ${dayIndex}`);
      return day.exercises.map((exercise, position) => ({
        ...exercise,
        plan_day_id: planDayId,
        position,
        rpe_target: exercise.rpe_target ?? null,
        rest_seconds: exercise.rest_seconds ?? null,
        role: exercise.role ?? null,
        note: exercise.note ?? null,
      }));
    });

    const { error: exercisesError } = await supabase
      .from("plan_exercises")
      .insert(exerciseRows);
    if (exercisesError) throw exercisesError;

    return trainingPlan;
  } catch (error) {
    let cleanupError: string | null = null;
    if (createdPlanId) {
      const { error: deleteError } = await supabase
        .from("training_plans")
        .delete()
        .eq("id", createdPlanId);
      cleanupError = deleteError ? errorMessage(deleteError) : null;
    }
    const restoreError = await restoreActivePlans(supabase, previousPlanIds);
    if (cleanupError || restoreError) {
      throw new Error(
        `${errorMessage(error)}; compensation failed: ${[
          cleanupError && `delete new plan: ${cleanupError}`,
          restoreError && `restore prior plan: ${restoreError}`,
        ]
          .filter(Boolean)
          .join(", ")}`,
      );
    }
    throw error;
  }
}

export async function deactivatePlan(
  supabase: SupabaseClient,
  planId: string,
): Promise<void> {
  const { error } = await supabase
    .from("training_plans")
    .update({ active: false })
    .eq("id", planId);
  if (error) throw error;
}
