// Training plan data access. A plan says what to DO; workout_sets still records
// what was done, so nothing here touches history or analytics.
//
// Plans carry no weights, only sets and rep ranges. The weight comes from the
// athlete's own history at log time, which keeps plans entirely clear of the
// kg/lb seam described in golden rule 3.
//
// Tables come from migration 0016, all RLS-owned. Read docs/HANDOFF_PLANNER.md.

import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey } from "@/lib/analytics/dates";
import type {
  PlanDayWithExercises,
  PlanExerciseRole,
  PlanGoal,
  PlanSplit,
  PlanWithDays,
} from "@/lib/types";

/** Raw shape of the nested select below. */
interface RawPlanRow {
  id: string;
  user_id: string;
  name: string;
  goal: string;
  split: string;
  days_per_week: number;
  session_minutes: number | null;
  equipment: string[] | null;
  avoid: string[] | null;
  mesocycle_weeks: number;
  deload_week: number | null;
  notes: string | null;
  active: boolean;
  started_on: string;
  created_at: string;
  updated_at: string;
  plan_days: {
    id: string;
    plan_id: string;
    day_index: number;
    name: string;
    focus: string | null;
    plan_exercises: {
      id: string;
      plan_day_id: string;
      exercise_id: string;
      position: number;
      sets: number;
      rep_low: number;
      rep_high: number;
      rpe_target: number | string | null;
      rest_seconds: number | null;
      role: string | null;
      note: string | null;
      exercises: { name: string; muscle_group: string; equipment: string | null } | null;
    }[] | null;
  }[] | null;
}

const SELECT = `
  *,
  plan_days (
    id, plan_id, day_index, name, focus,
    plan_exercises (
      id, plan_day_id, exercise_id, position, sets, rep_low, rep_high,
      rpe_target, rest_seconds, role, note,
      exercises ( name, muscle_group, equipment )
    )
  )
`;

function mapPlan(row: RawPlanRow): PlanWithDays {
  // Order in JS rather than in the query: PostgREST ordering inside nested
  // embeds is unreliable, and a plan is small enough that sorting is free.
  const days = (row.plan_days ?? [])
    .slice()
    .sort((a, b) => a.day_index - b.day_index)
    .map((d) => ({
      id: d.id,
      plan_id: d.plan_id,
      day_index: d.day_index,
      name: d.name,
      focus: d.focus,
      exercises: (d.plan_exercises ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        // A planned exercise whose library row is missing is kept, not dropped.
        // Dropping it would make the day quietly incomplete; the validation
        // layer is where a broken reference gets named.
        .map((e) => ({
          id: e.id,
          plan_day_id: e.plan_day_id,
          exercise_id: e.exercise_id,
          position: e.position,
          sets: e.sets,
          rep_low: e.rep_low,
          rep_high: e.rep_high,
          rpe_target: e.rpe_target != null ? Number(e.rpe_target) : null,
          rest_seconds: e.rest_seconds,
          role: (e.role as PlanExerciseRole | null) ?? null,
          note: e.note,
          name: e.exercises?.name ?? "Unknown exercise",
          muscle_group: e.exercises?.muscle_group ?? "",
          equipment: e.exercises?.equipment ?? null,
        })),
    }));

  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    goal: row.goal as PlanGoal,
    split: row.split as PlanSplit,
    days_per_week: row.days_per_week,
    session_minutes: row.session_minutes,
    equipment: row.equipment ?? [],
    avoid: row.avoid ?? [],
    mesocycle_weeks: row.mesocycle_weeks,
    deload_week: row.deload_week,
    notes: row.notes,
    active: row.active,
    started_on: row.started_on,
    created_at: row.created_at,
    updated_at: row.updated_at,
    days,
  };
}

/**
 * The athlete's active plan with days and exercises resolved, or null.
 *
 * One query with nested embeds rather than a day-by-day fetch: a plan is at
 * most seven days of about six exercises, so it fits comfortably in one round
 * trip and the Log screen needs all of it anyway.
 */
export async function getActivePlan(supabase: SupabaseClient): Promise<PlanWithDays | null> {
  const { data, error } = await supabase
    .from("training_plans")
    .select(SELECT)
    .eq("active", true)
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as RawPlanRow | undefined;
  return row ? mapPlan(row) : null;
}

/**
 * Which day of the rotation comes next, as an index into an ordered day list.
 *
 * Driven by sessions actually logged, NOT by the calendar weekday. A lifter who
 * skips Tuesday still wants Push A next, not Legs. Anchoring to weekdays would
 * silently drop a day from the rotation every time life happened.
 *
 * Sessions dated today do not advance the rotation, so opening the app midway
 * through a workout still shows the day being worked rather than the next one.
 *
 * Pure, so the rotation rule is testable without a database.
 */
export function nextDayIndex(
  sessionDates: string[],
  dayCount: number,
  today: string,
): number {
  if (dayCount <= 0) return 0;
  // Distinct calendar dates: two sessions in one day are one training day.
  const before = new Set(sessionDates.filter((d) => d.slice(0, 10) < today).map((d) => d.slice(0, 10)));
  return before.size % dayCount;
}

/**
 * Current 1-indexed week inside a repeating mesocycle.
 *
 * A plan week begins on the plan's own start date, not on Monday. That keeps a
 * plan created midweek from jumping to week 2 after only a few days. Date-only
 * UTC arithmetic avoids daylight-saving changes turning a seven-day span into
 * six or eight days.
 */
export function planCycleWeek(
  startedOn: string,
  mesocycleWeeks: number,
  today: string,
): number {
  if (!Number.isInteger(mesocycleWeeks) || mesocycleWeeks < 1) return 1;
  const started = Date.parse(`${startedOn.slice(0, 10)}T00:00:00Z`);
  const current = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(started) || !Number.isFinite(current) || current <= started) {
    return 1;
  }

  const elapsedDays = Math.floor((current - started) / (24 * 60 * 60 * 1000));
  return (Math.floor(elapsedDays / 7) % mesocycleWeeks) + 1;
}

/** Whether today falls in the plan's explicit deload week. */
export function isScheduledDeloadWeek(
  plan: Pick<PlanWithDays, "started_on" | "mesocycle_weeks" | "deload_week">,
  today: string,
): boolean {
  if (plan.deload_week == null) return false;
  return planCycleWeek(plan.started_on, plan.mesocycle_weeks, today) === plan.deload_week;
}

/**
 * Today's planned session, or null when there is no active plan.
 *
 * Only sessions logged on or after the plan's start date count, so activating a
 * new plan restarts the rotation instead of inheriting the old plan's position.
 */
export async function getPlanDayForToday(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ plan: PlanWithDays; day: PlanDayWithExercises } | null> {
  const plan = await getActivePlan(supabase);
  if (!plan || plan.days.length === 0) return null;

  const { data, error } = await supabase
    .from("workout_sessions")
    .select("performed_at")
    .gte("performed_at", plan.started_on);
  if (error) throw error;

  const dates = ((data ?? []) as { performed_at: string }[]).map((r) => r.performed_at);
  const idx = nextDayIndex(dates, plan.days.length, localDateKey(now));
  return { plan, day: plan.days[idx] };
}

export interface NewPlanExercise {
  exercise_id: string;
  sets: number;
  rep_low: number;
  rep_high: number;
  rpe_target?: number | null;
  rest_seconds?: number | null;
  role?: PlanExerciseRole | null;
  note?: string | null;
}

export interface NewPlanDay {
  name: string;
  focus?: string | null;
  exercises: NewPlanExercise[];
}

export interface NewPlan {
  name: string;
  goal: PlanGoal;
  split: PlanSplit;
  days_per_week: number;
  session_minutes?: number | null;
  equipment?: string[];
  avoid?: string[];
  mesocycle_weeks?: number;
  deload_week?: number | null;
  notes?: string | null;
  days: NewPlanDay[];
}

/**
 * Insert a plan and activate it, returning the new plan id.
 *
 * A plan spans three tables and Supabase JS has no transactions, so this runs
 * a compensating rollback by hand. Without one, a failure partway leaves the
 * athlete's previous plan deactivated AND a new empty plan active: a broken
 * state with no route back, on the screen they open every session.
 *
 * On any failure the new plan is deleted, which cascades to its days and
 * exercises, and whatever was active before is reactivated. If the compensation
 * itself fails the thrown error says so, because a silent half-rollback is
 * worse than a loud one.
 *
 * The rollback approach here comes from Terra's parallel implementation in
 * PR #2, which caught this hole in the original version of this function.
 *
 * `position` and `day_index` are assigned from array order, so callers express
 * order by ordering the arrays and cannot get the two out of sync.
 */
export async function createPlan(supabase: SupabaseClient, input: NewPlan): Promise<string> {
  if (input.days.length === 0) throw new Error("A plan needs at least one day.");
  if (input.days.length !== input.days_per_week) {
    throw new Error("A plan's day count has to match days_per_week.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  // Capture what gets deactivated so it can be put back if the insert fails.
  const { data: deactivated, error: deactivateErr } = await supabase
    .from("training_plans")
    .update({ active: false })
    .eq("user_id", user.id)
    .eq("active", true)
    .select("id");
  if (deactivateErr) throw deactivateErr;
  const previouslyActive = ((deactivated ?? []) as { id: string }[]).map((r) => r.id);

  let planId: string | null = null;
  try {
    const { data: planRow, error: planErr } = await supabase
      .from("training_plans")
      .insert({
        user_id: user.id,
        name: input.name,
        goal: input.goal,
        split: input.split,
        days_per_week: input.days_per_week,
        session_minutes: input.session_minutes ?? null,
        equipment: input.equipment ?? [],
        avoid: input.avoid ?? [],
        mesocycle_weeks: input.mesocycle_weeks ?? 5,
        deload_week: input.deload_week ?? null,
        notes: input.notes ?? null,
        active: true,
      })
      .select("id")
      .single();
    if (planErr) throw planErr;
    planId = (planRow as { id: string }).id;

    const { data: dayRows, error: dayErr } = await supabase
      .from("plan_days")
      .insert(
        input.days.map((d, i) => ({
          plan_id: planId,
          day_index: i,
          name: d.name,
          focus: d.focus ?? null,
        })),
      )
      .select("id, day_index");
    if (dayErr) throw dayErr;

    const idByIndex = new Map(
      ((dayRows ?? []) as { id: string; day_index: number }[]).map((r) => [r.day_index, r.id]),
    );
    if (idByIndex.size !== input.days.length) {
      throw new Error("The database did not return every inserted plan day.");
    }

    const exercises = input.days.flatMap((d, i) =>
      d.exercises.map((e, pos) => ({
        plan_day_id: idByIndex.get(i)!,
        exercise_id: e.exercise_id,
        position: pos,
        sets: e.sets,
        rep_low: e.rep_low,
        rep_high: e.rep_high,
        rpe_target: e.rpe_target ?? null,
        rest_seconds: e.rest_seconds ?? null,
        role: e.role ?? null,
        note: e.note ?? null,
      })),
    );
    if (exercises.length > 0) {
      const { error } = await supabase.from("plan_exercises").insert(exercises);
      if (error) throw error;
    }

    return planId;
  } catch (err) {
    const failures: string[] = [];
    if (planId) {
      // Cascades to plan_days and plan_exercises via migration 0016.
      const { error } = await supabase.from("training_plans").delete().eq("id", planId);
      if (error) failures.push(`could not delete the partial plan: ${error.message}`);
    }
    if (previouslyActive.length > 0) {
      const { error } = await supabase
        .from("training_plans")
        .update({ active: true })
        .in("id", previouslyActive);
      if (error) failures.push(`could not reactivate the previous plan: ${error.message}`);
    }
    if (failures.length > 0) {
      const original = err instanceof Error ? err.message : String(err);
      throw new Error(`${original}. Rollback also failed: ${failures.join(", ")}.`);
    }
    throw err;
  }
}

export async function deactivatePlan(supabase: SupabaseClient, planId: string): Promise<void> {
  const { error } = await supabase
    .from("training_plans")
    .update({ active: false })
    .eq("id", planId);
  if (error) throw error;
}
