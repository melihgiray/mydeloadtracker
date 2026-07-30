import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi } from "vitest";
import {
  createPlan,
  isScheduledDeloadWeek,
  nextDayIndex,
  planCycleWeek,
  type NewPlan,
} from "@/lib/plans";

// The rotation rule is the one piece of real logic in plans.ts, and getting it
// wrong is invisible: the app would just show the wrong day. It is pure so it
// can be pinned without a database.

describe("nextDayIndex", () => {
  it("starts at the first day when nothing has been logged", () => {
    expect(nextDayIndex([], 4, "2026-07-29")).toBe(0);
  });

  it("advances one day per logged training day", () => {
    expect(nextDayIndex(["2026-07-27"], 4, "2026-07-29")).toBe(1);
    expect(nextDayIndex(["2026-07-26", "2026-07-27"], 4, "2026-07-29")).toBe(2);
  });

  it("wraps around at the end of the rotation", () => {
    const dates = ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27"];
    expect(nextDayIndex(dates, 4, "2026-07-29")).toBe(0);
  });

  // The reason this is session-driven rather than weekday-driven. A lifter who
  // skips a day should resume where they left off, not lose that day forever.
  it("does not skip a day when the athlete misses a week", () => {
    const afterOneSession = nextDayIndex(["2026-07-01"], 4, "2026-07-29");
    expect(afterOneSession).toBe(1);
  });

  // Opening the app mid-workout must not jump to tomorrow's session.
  it("does not advance for a session logged today", () => {
    expect(nextDayIndex(["2026-07-29"], 4, "2026-07-29")).toBe(0);
    expect(nextDayIndex(["2026-07-27", "2026-07-29"], 4, "2026-07-29")).toBe(1);
  });

  it("counts two sessions in one day as one training day", () => {
    expect(nextDayIndex(["2026-07-27", "2026-07-27"], 4, "2026-07-29")).toBe(1);
  });

  it("accepts full timestamps, not just date keys", () => {
    expect(nextDayIndex(["2026-07-27T18:30:00.000Z"], 4, "2026-07-29")).toBe(1);
  });

  it("ignores ordering of the input dates", () => {
    const shuffled = ["2026-07-27", "2026-07-24", "2026-07-26", "2026-07-25"];
    expect(nextDayIndex(shuffled, 4, "2026-07-29")).toBe(0);
  });

  it("returns 0 rather than dividing by zero on a plan with no days", () => {
    expect(nextDayIndex(["2026-07-27"], 0, "2026-07-29")).toBe(0);
  });

  it("stays in range for every rotation length and history size", () => {
    for (let dayCount = 1; dayCount <= 7; dayCount++) {
      for (let logged = 0; logged <= 20; logged++) {
        const dates = Array.from({ length: logged }, (_, i) => `2026-0${1 + (i % 9)}-0${1 + (i % 9)}`);
        const idx = nextDayIndex(dates, dayCount, "2026-12-31");
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(dayCount);
      }
    }
  });
});

describe("planCycleWeek", () => {
  it("starts in week 1 and changes only after seven full days", () => {
    expect(planCycleWeek("2026-07-29", 5, "2026-07-29")).toBe(1);
    expect(planCycleWeek("2026-07-29", 5, "2026-08-04")).toBe(1);
    expect(planCycleWeek("2026-07-29", 5, "2026-08-05")).toBe(2);
  });

  it("repeats the mesocycle after its last week", () => {
    expect(planCycleWeek("2026-07-01", 5, "2026-07-29")).toBe(5);
    expect(planCycleWeek("2026-07-01", 5, "2026-08-05")).toBe(1);
  });

  it("does not move before a future start date", () => {
    expect(planCycleWeek("2026-08-05", 5, "2026-07-29")).toBe(1);
  });

  it("fails safe on invalid cycle data", () => {
    expect(planCycleWeek("not-a-date", 5, "2026-07-29")).toBe(1);
    expect(planCycleWeek("2026-07-29", 0, "2026-08-29")).toBe(1);
  });
});

describe("isScheduledDeloadWeek", () => {
  const plan = {
    started_on: "2026-07-01",
    mesocycle_weeks: 5,
    deload_week: 5,
  };

  it("recognizes the plan's explicit deload week", () => {
    expect(isScheduledDeloadWeek(plan, "2026-07-29")).toBe(true);
    expect(isScheduledDeloadWeek(plan, "2026-07-22")).toBe(false);
  });

  it("does not synthesize a schedule when deload_week is null", () => {
    expect(isScheduledDeloadWeek({ ...plan, deload_week: null }, "2026-07-29")).toBe(false);
  });
});

// The rollback in createPlan cannot be reached by a pure function, so these use
// a fake Supabase query builder. The harness pattern is adapted from Terra's
// parallel implementation in PR #2, which is what caught the missing rollback.

interface Result {
  data: unknown;
  error: unknown;
}

/** Records every table operation so a test can assert the compensation ran. */
function fakeSupabase(
  results: Record<string, Result[]>,
  log: { table: string; op: string }[],
) {
  const take = (table: string): Result => {
    const queue = results[table];
    if (!queue || queue.length === 0) return { data: null, error: null };
    return queue.length === 1 ? queue[0] : queue.shift()!;
  };

  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "eq", "gte", "in", "order", "limit"]) builder[m] = vi.fn(chain);
      for (const m of ["insert", "update", "delete"]) {
        builder[m] = vi.fn(() => {
          log.push({ table, op: m });
          return builder;
        });
      }
      const settle = () => Promise.resolve(take(table));
      builder.single = vi.fn(settle);
      builder.maybeSingle = vi.fn(settle);
      builder.then = (onOk: (r: Result) => unknown, onErr?: (e: unknown) => unknown) =>
        settle().then(onOk, onErr);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const newPlan = (): NewPlan => ({
  name: "Test",
  goal: "both",
  split: "upper_lower",
  days_per_week: 1,
  days: [{ name: "Upper A", exercises: [{ exercise_id: "ex1", sets: 3, rep_low: 5, rep_high: 8 }] }],
});

describe("createPlan invariants", () => {
  it("refuses a plan with no days", async () => {
    const log: { table: string; op: string }[] = [];
    await expect(
      createPlan(fakeSupabase({}, log), { ...newPlan(), days: [], days_per_week: 0 }),
    ).rejects.toThrow(/at least one day/);
    // Nothing was touched, so there is nothing to roll back.
    expect(log).toHaveLength(0);
  });

  it("refuses a plan whose day count disagrees with days_per_week", async () => {
    const log: { table: string; op: string }[] = [];
    await expect(
      createPlan(fakeSupabase({}, log), { ...newPlan(), days_per_week: 4 }),
    ).rejects.toThrow(/days_per_week/);
    expect(log).toHaveLength(0);
  });
});

describe("createPlan rollback", () => {
  it("returns the new plan id on the happy path", async () => {
    const log: { table: string; op: string }[] = [];
    const supabase = fakeSupabase(
      {
        training_plans: [{ data: [{ id: "old" }], error: null }, { data: { id: "new" }, error: null }],
        plan_days: [{ data: [{ id: "d0", day_index: 0 }], error: null }],
        plan_exercises: [{ data: null, error: null }],
      },
      log,
    );
    await expect(createPlan(supabase, newPlan())).resolves.toBe("new");
    expect(log.some((l) => l.table === "training_plans" && l.op === "delete")).toBe(false);
  });

  // The bug this whole block exists for. Without compensation the athlete is
  // left with their old plan off and an empty plan on.
  it("deletes the partial plan and reactivates the previous one when days fail", async () => {
    const log: { table: string; op: string }[] = [];
    const supabase = fakeSupabase(
      {
        training_plans: [
          { data: [{ id: "old" }], error: null }, // deactivate returns prior active
          { data: { id: "new" }, error: null }, // insert the new plan
          { data: null, error: null }, // delete during rollback
          { data: null, error: null }, // reactivate during rollback
        ],
        plan_days: [{ data: null, error: { message: "days blew up" } }],
      },
      log,
    );
    await expect(createPlan(supabase, newPlan())).rejects.toThrow(/days blew up/);
    expect(log).toEqual(
      expect.arrayContaining([
        { table: "training_plans", op: "update" }, // the initial deactivate
        { table: "training_plans", op: "insert" },
        { table: "plan_days", op: "insert" },
        { table: "training_plans", op: "delete" }, // compensation
        { table: "training_plans", op: "update" }, // reactivate
      ]),
    );
  });

  it("rolls back when the exercise insert fails", async () => {
    const log: { table: string; op: string }[] = [];
    const supabase = fakeSupabase(
      {
        training_plans: [
          { data: [{ id: "old" }], error: null },
          { data: { id: "new" }, error: null },
          { data: null, error: null },
          { data: null, error: null },
        ],
        plan_days: [{ data: [{ id: "d0", day_index: 0 }], error: null }],
        plan_exercises: [{ data: null, error: { message: "exercises blew up" } }],
      },
      log,
    );
    await expect(createPlan(supabase, newPlan())).rejects.toThrow(/exercises blew up/);
    expect(log.filter((l) => l.table === "training_plans" && l.op === "delete")).toHaveLength(1);
  });

  it("reports a failed rollback rather than hiding it behind the original error", async () => {
    const log: { table: string; op: string }[] = [];
    const supabase = fakeSupabase(
      {
        training_plans: [
          { data: [{ id: "old" }], error: null },
          { data: { id: "new" }, error: null },
          { data: null, error: { message: "delete denied" } },
        ],
        plan_days: [{ data: null, error: { message: "days blew up" } }],
      },
      log,
    );
    await expect(createPlan(supabase, newPlan())).rejects.toThrow(/Rollback also failed/);
  });

  it("fails loudly when the database returns fewer days than were inserted", async () => {
    const log: { table: string; op: string }[] = [];
    const supabase = fakeSupabase(
      {
        training_plans: [
          { data: [], error: null },
          { data: { id: "new" }, error: null },
          { data: null, error: null },
        ],
        plan_days: [{ data: [], error: null }],
      },
      log,
    );
    await expect(createPlan(supabase, newPlan())).rejects.toThrow(/every inserted plan day/);
  });
});
