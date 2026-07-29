import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createPlan,
  deactivatePlan,
  getActivePlan,
  getPlanDayForToday,
  type CreatePlanInput,
} from "@/lib/plans";

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: PromiseLike<QueryResult>["then"];
}

function queryBuilder(result: QueryResult): QueryBuilder {
  const builder = {} as QueryBuilder;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (onfulfilled, onrejected) =>
    Promise.resolve(result).then(onfulfilled, onrejected);
  return builder;
}

function mockSupabase(
  builders: QueryBuilder[],
  userId: string = "user-1",
): { supabase: SupabaseClient; from: ReturnType<typeof vi.fn> } {
  const from = vi.fn();
  for (const builder of builders) from.mockReturnValueOnce(builder);
  return {
    supabase: {
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient,
    from,
  };
}

const exercise = {
  id: "exercise-1",
  user_id: null,
  name: "Bench Press",
  muscle_group: "Chest",
  movement_pattern: "Horizontal Push",
  equipment: "barbell",
  is_major: true,
  hidden: false,
  created_at: "2026-07-01T00:00:00.000Z",
};

const activePlanRow = {
  id: "plan-1",
  user_id: "user-1",
  name: "Upper Lower",
  goal: "both",
  split: "upper_lower",
  days_per_week: 2,
  session_minutes: 60,
  equipment: ["barbell"],
  avoid: [],
  mesocycle_weeks: 5,
  deload_week: 5,
  notes: null,
  active: true,
  started_on: "2026-07-01",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  plan_days: [
    {
      id: "day-1",
      plan_id: "plan-1",
      day_index: 1,
      name: "Lower",
      focus: "legs",
      plan_exercises: [
        {
          id: "plan-exercise-2",
          plan_day_id: "day-1",
          exercise_id: "exercise-1",
          position: 1,
          sets: 3,
          rep_low: 8,
          rep_high: 10,
          rpe_target: 8,
          rest_seconds: 120,
          role: "secondary",
          note: null,
          exercise,
        },
        {
          id: "plan-exercise-1",
          plan_day_id: "day-1",
          exercise_id: "exercise-1",
          position: 0,
          sets: 3,
          rep_low: 5,
          rep_high: 8,
          rpe_target: 8,
          rest_seconds: 180,
          role: "primary",
          note: null,
          exercise,
        },
      ],
    },
    {
      id: "day-0",
      plan_id: "plan-1",
      day_index: 0,
      name: "Upper",
      focus: "upper body",
      plan_exercises: [],
    },
  ],
};

const createInput: CreatePlanInput = {
  name: "Upper Lower",
  goal: "both",
  split: "upper_lower",
  days_per_week: 2,
  session_minutes: 60,
  equipment: ["barbell"],
  days: [
    {
      name: "Upper",
      exercises: [{ exercise_id: "bench", sets: 3, rep_low: 5, rep_high: 8 }],
    },
    {
      name: "Lower",
      focus: "legs",
      exercises: [{ exercise_id: "squat", sets: 4, rep_low: 4, rep_high: 6 }],
    },
  ],
};

describe("plan data layer", () => {
  it("loads one active plan with one nested query and normalizes ordering", async () => {
    const active = queryBuilder({ data: activePlanRow, error: null });
    const { supabase, from } = mockSupabase([active]);

    const result = await getActivePlan(supabase);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("training_plans");
    expect(active.select).toHaveBeenCalledWith(
      "*, plan_days(*, plan_exercises(*, exercise:exercises(*)))",
    );
    expect(active.eq).toHaveBeenCalledWith("active", true);
    expect(result?.days.map((day) => day.day_index)).toEqual([0, 1]);
    expect(result?.days[1].exercises.map((item) => item.position)).toEqual([0, 1]);
  });

  it("returns null when no active plan exists", async () => {
    const active = queryBuilder({ data: null, error: null });
    const { supabase } = mockSupabase([active]);

    await expect(getActivePlan(supabase)).resolves.toBeNull();
  });

  it("advances by distinct logged dates rather than calendar weekdays", async () => {
    const active = queryBuilder({ data: activePlanRow, error: null });
    const sessions = queryBuilder({
      data: [
        { performed_at: "2026-07-01T17:00:00.000Z" },
        { performed_at: "2026-07-01T18:00:00.000Z" },
        { performed_at: "2026-07-08T17:00:00.000Z" },
        { performed_at: "2026-07-29T17:00:00.000Z" },
      ],
      error: null,
    });
    const { supabase } = mockSupabase([active, sessions]);

    const result = await getPlanDayForToday(supabase);

    expect(sessions.gte).toHaveBeenCalledWith(
      "performed_at",
      "2026-07-01T00:00:00.000Z",
    );
    expect(result?.day_index).toBe(1);
    expect(result?.name).toBe("Lower");
  });

  it("deactivates the old plan before inserting ordered days and exercises", async () => {
    const deactivate = queryBuilder({ data: [{ id: "old-plan" }], error: null });
    const insertPlan = queryBuilder({
      data: { ...activePlanRow, plan_days: undefined },
      error: null,
    });
    const insertDays = queryBuilder({
      data: [
        { id: "day-0", plan_id: "plan-1", day_index: 0, name: "Upper", focus: null },
        { id: "day-1", plan_id: "plan-1", day_index: 1, name: "Lower", focus: "legs" },
      ],
      error: null,
    });
    const insertExercises = queryBuilder({ data: null, error: null });
    const { supabase, from } = mockSupabase([
      deactivate,
      insertPlan,
      insertDays,
      insertExercises,
    ]);

    const result = await createPlan(supabase, createInput);

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "training_plans",
      "training_plans",
      "plan_days",
      "plan_exercises",
    ]);
    expect(deactivate.update).toHaveBeenCalledWith({ active: false });
    expect(deactivate.eq).toHaveBeenCalledWith("active", true);
    expect(insertDays.insert).toHaveBeenCalledWith([
      { plan_id: "plan-1", day_index: 0, name: "Upper", focus: null },
      { plan_id: "plan-1", day_index: 1, name: "Lower", focus: "legs" },
    ]);
    expect(insertExercises.insert).toHaveBeenCalledWith([
      {
        exercise_id: "bench",
        sets: 3,
        rep_low: 5,
        rep_high: 8,
        plan_day_id: "day-0",
        position: 0,
        rpe_target: null,
        rest_seconds: null,
        role: null,
        note: null,
      },
      {
        exercise_id: "squat",
        sets: 4,
        rep_low: 4,
        rep_high: 6,
        plan_day_id: "day-1",
        position: 0,
        rpe_target: null,
        rest_seconds: null,
        role: null,
        note: null,
      },
    ]);
    expect(result.id).toBe("plan-1");
  });

  it("deletes a partial new plan and restores the prior active plan on failure", async () => {
    const deactivate = queryBuilder({ data: [{ id: "old-plan" }], error: null });
    const insertPlan = queryBuilder({
      data: { ...activePlanRow, plan_days: undefined },
      error: null,
    });
    const insertDays = queryBuilder({ data: null, error: new Error("day insert failed") });
    const deleteNewPlan = queryBuilder({ data: null, error: null });
    const restoreOldPlan = queryBuilder({ data: null, error: null });
    const { supabase, from } = mockSupabase([
      deactivate,
      insertPlan,
      insertDays,
      deleteNewPlan,
      restoreOldPlan,
    ]);

    await expect(createPlan(supabase, createInput)).rejects.toThrow("day insert failed");

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "training_plans",
      "training_plans",
      "plan_days",
      "training_plans",
      "training_plans",
    ]);
    expect(deleteNewPlan.delete).toHaveBeenCalledOnce();
    expect(deleteNewPlan.eq).toHaveBeenCalledWith("id", "plan-1");
    expect(restoreOldPlan.update).toHaveBeenCalledWith({ active: true });
    expect(restoreOldPlan.in).toHaveBeenCalledWith("id", ["old-plan"]);
  });

  it("deactivates a requested plan id", async () => {
    const deactivate = queryBuilder({ data: null, error: null });
    const { supabase } = mockSupabase([deactivate]);

    await deactivatePlan(supabase, "plan-1");

    expect(deactivate.update).toHaveBeenCalledWith({ active: false });
    expect(deactivate.eq).toHaveBeenCalledWith("id", "plan-1");
  });
});
