import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { applyPatchToPlan, undoLastRevision } from "@/lib/plan-edit";
import type { Exercise, PlanWithDays } from "@/lib/types";

// Undo is database code, so this uses a fake query builder in the same shape as
// the createPlan harness in plans.test.ts.
//
// It exists because of a defect that only appeared when the button was pressed
// TWICE. Undo used to append the restored state as a new revision so that an
// undo could itself be undone. The next undo then found the undone change one
// row back and restored it, so two presses returned the athlete to where they
// started. Nothing in the code looked wrong; the second press is what showed it.

function snapshot(name: string): PlanWithDays {
  return {
    id: "p1",
    user_id: "u1",
    name: "Plan",
    goal: "hypertrophy",
    split: "full_body",
    days_per_week: 1,
    session_minutes: 60,
    equipment: ["barbell"],
    avoid: [],
    mesocycle_weeks: 5,
    deload_week: 5,
    notes: null,
    last_reviewed_on: null,
    training_style: null,
    active: true,
    started_on: "2026-07-01",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    days: [{ id: "d1", plan_id: "p1", day_index: 0, name, focus: null, exercises: [] }],
  };
}

interface Op {
  table: string;
  op: string;
  revision?: number;
}

/** Serves a fixed revision list and records every write. */
function fakeSupabase(revisions: { revision: number; snapshot: PlanWithDays }[], log: Op[]) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let pending: string | null = null;
      let revisionArg: number | undefined;

      const chain = () => builder;
      for (const m of ["select", "order", "limit"]) builder[m] = vi.fn(chain);
      builder.eq = vi.fn((column: string, value: unknown) => {
        if (column === "revision") revisionArg = value as number;
        return builder;
      });
      for (const m of ["insert", "update", "delete"]) {
        builder[m] = vi.fn(() => {
          pending = m;
          if (m !== "delete") log.push({ table, op: m });
          return builder;
        });
      }

      const settle = () => {
        if (pending === "delete") log.push({ table, op: "delete", revision: revisionArg });
        if (pending) return Promise.resolve({ data: null, error: null });
        if (table === "plan_revisions") {
          // Newest first, capped at the limit the caller asked for.
          return Promise.resolve({
            data: revisions
              .slice()
              .sort((a, b) => b.revision - a.revision)
              .slice(0, 2)
              .map((r) => ({ ...r, summary: `change ${r.revision}` })),
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };
      builder.then = (ok: (r: unknown) => unknown, err?: (e: unknown) => unknown) =>
        settle().then(ok, err);
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("undoLastRevision", () => {
  it("restores the previous snapshot", async () => {
    const log: Op[] = [];
    const restored = await undoLastRevision(
      fakeSupabase(
        [
          { revision: 1, snapshot: snapshot("Original") },
          { revision: 2, snapshot: snapshot("Renamed") },
        ],
        log,
      ),
      "p1",
    );
    expect(restored?.days[0].name).toBe("Original");
  });

  it("DROPS the undone revision instead of appending a new one", async () => {
    // The fix. An appended undo revision is what made the second press restore
    // the change the first press had just reverted.
    const log: Op[] = [];
    await undoLastRevision(
      fakeSupabase(
        [
          { revision: 1, snapshot: snapshot("Original") },
          { revision: 2, snapshot: snapshot("Renamed") },
        ],
        log,
      ),
      "p1",
    );
    const revisionWrites = log.filter((l) => l.table === "plan_revisions");
    expect(revisionWrites).toEqual([{ table: "plan_revisions", op: "delete", revision: 2 }]);
    expect(revisionWrites.some((l) => l.op === "insert")).toBe(false);
  });

  it("does nothing when there is only a baseline to fall back to", async () => {
    const log: Op[] = [];
    const restored = await undoLastRevision(
      fakeSupabase([{ revision: 0, snapshot: snapshot("Original") }], log),
      "p1",
    );
    expect(restored).toBeNull();
    // Nothing was restored, so nothing may be deleted. Otherwise the last
    // revision would be destroyed with no state change to show for it.
    expect(log).toHaveLength(0);
  });
});

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface Mutation {
  table: string;
  op: string;
  value: unknown;
}

/** Queue database results by table and operation, and retain write payloads. */
function fakeEditSupabase(results: Record<string, QueryResult[]>, log: Mutation[]) {
  const take = (key: string): QueryResult => {
    const queue = results[key];
    if (!queue || queue.length === 0) return { data: null, error: null };
    return queue.length === 1 ? queue[0] : queue.shift()!;
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let pending = "select";
      let value: unknown = null;
      const chain = () => builder;

      for (const method of ["select", "eq", "order", "limit"]) builder[method] = vi.fn(chain);
      for (const method of ["insert", "update", "delete"]) {
        builder[method] = vi.fn((nextValue: unknown) => {
          pending = method;
          value = nextValue;
          log.push({ table, op: method, value: nextValue });
          return builder;
        });
      }

      const settle = () => Promise.resolve(take(`${table}.${pending}`));
      builder.then = (ok: (result: QueryResult) => unknown, err?: (error: unknown) => unknown) =>
        settle().then(ok, err);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const editLibrary: Exercise[] = [
  {
    id: "bench",
    user_id: null,
    name: "Bench Press",
    muscle_group: "Chest",
    movement_pattern: "Horizontal Push",
    equipment: "barbell",
    is_major: true,
    hidden: false,
    created_at: "2026-07-01T00:00:00.000Z",
  },
];

function editablePlan(): PlanWithDays {
  const plan = snapshot("Upper A");
  plan.days[0].exercises = [
    {
      id: "pe1",
      plan_day_id: "d1",
      exercise_id: "bench",
      position: 0,
      sets: 3,
      rep_low: 8,
      rep_high: 12,
      rpe_target: 9,
      rest_seconds: 120,
      role: "primary",
      note: null,
      name: "Bench Press",
      muscle_group: "Chest",
      equipment: "barbell",
    },
  ];
  return plan;
}

function planAtSets(sets: number): PlanWithDays {
  const plan = editablePlan();
  plan.days[0].exercises[0].sets = sets;
  return plan;
}

describe("undoLastRevision compensation", () => {
  const revisions = () => [
    { revision: 2, snapshot: planAtSets(4), summary: "Four sets" },
    { revision: 1, snapshot: planAtSets(3), summary: "Three sets" },
  ];

  it("restores the current snapshot when stepping back fails", async () => {
    const log: Mutation[] = [];
    const supabase = fakeEditSupabase(
      {
        "plan_revisions.select": [
          {
            data: revisions(),
            error: null,
          },
        ],
        "plan_days.update": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.delete": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.insert": [
          { data: null, error: { message: "previous snapshot failed" } },
          { data: null, error: null },
        ],
      },
      log,
    );

    await expect(undoLastRevision(supabase, "p1")).rejects.toThrow(/previous snapshot failed/);

    const insertedSets = log
      .filter((entry) => entry.table === "plan_exercises" && entry.op === "insert")
      .map((entry) => (entry.value as { sets: number }[])[0].sets);
    expect(insertedSets).toEqual([3, 4]);
    expect(
      log.filter((entry) => entry.table === "plan_revisions" && entry.op === "delete"),
    ).toHaveLength(0);
  });

  it("restores the current snapshot when dropping the undone revision fails", async () => {
    const log: Mutation[] = [];
    const supabase = fakeEditSupabase(
      {
        "plan_revisions.select": [{ data: revisions(), error: null }],
        "plan_revisions.delete": [
          { data: null, error: { message: "revision delete failed" } },
        ],
        "plan_days.update": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.delete": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.insert": [
          { data: null, error: null },
          { data: null, error: null },
        ],
      },
      log,
    );

    await expect(undoLastRevision(supabase, "p1")).rejects.toThrow(/revision delete failed/);

    const insertedSets = log
      .filter((entry) => entry.table === "plan_exercises" && entry.op === "insert")
      .map((entry) => (entry.value as { sets: number }[])[0].sets);
    expect(insertedSets).toEqual([3, 4]);
  });

  it("reports when restoring the current snapshot also fails", async () => {
    const log: Mutation[] = [];
    const supabase = fakeEditSupabase(
      {
        "plan_revisions.select": [{ data: revisions(), error: null }],
        "plan_days.update": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.delete": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.insert": [
          { data: null, error: { message: "previous snapshot failed" } },
          { data: null, error: { message: "current restore failed" } },
        ],
      },
      log,
    );

    await expect(undoLastRevision(supabase, "p1")).rejects.toThrow(
      /Plan undo failed:.*previous snapshot failed.*Rollback also failed:.*current restore failed/,
    );
  });
});

describe("applyPatchToPlan compensation", () => {
  const fourSetPatch = [
    {
      op: "set_prescription" as const,
      dayIndex: 0,
      position: 0,
      sets: 4,
      reason: "Use four sets.",
    },
  ];

  it("restores the original day when inserting the edited day fails", async () => {
    const log: Mutation[] = [];
    const supabase = fakeEditSupabase(
      {
        "plan_revisions.select": [{ data: [], error: null }],
        "plan_revisions.insert": [{ data: null, error: null }],
        "plan_exercises.delete": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.insert": [
          { data: null, error: { message: "edited insert failed" } },
          { data: null, error: null },
        ],
        "plan_days.update": [{ data: null, error: null }],
      },
      log,
    );

    await expect(
      applyPatchToPlan(
        supabase,
        editablePlan(),
        fourSetPatch,
        "athlete_direct",
        editLibrary,
      ),
    ).rejects.toThrow(/edited insert failed/);

    const insertedSets = log
      .filter((entry) => entry.table === "plan_exercises" && entry.op === "insert")
      .map((entry) => (entry.value as { sets: number }[])[0].sets);
    expect(insertedSets).toEqual([4, 3]);
  });

  it("restores the original day when recording the revision fails", async () => {
    const log: Mutation[] = [];
    const supabase = fakeEditSupabase(
      {
        "plan_revisions.select": [
          { data: [], error: null },
          { data: [{ revision: 0 }], error: null },
        ],
        "plan_revisions.insert": [
          { data: null, error: null },
          { data: null, error: { message: "revision insert failed" } },
        ],
        "plan_exercises.delete": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.insert": [
          { data: null, error: null },
          { data: null, error: null },
        ],
      },
      log,
    );

    await expect(
      applyPatchToPlan(supabase, editablePlan(), fourSetPatch, "athlete_direct", editLibrary),
    ).rejects.toThrow(/revision insert failed/);

    const insertedSets = log
      .filter((entry) => entry.table === "plan_exercises" && entry.op === "insert")
      .map((entry) => (entry.value as { sets: number }[])[0].sets);
    expect(insertedSets).toEqual([4, 3]);
  });

  it("reports a failed compensation instead of hiding the partial state", async () => {
    const log: Mutation[] = [];
    const supabase = fakeEditSupabase(
      {
        "plan_revisions.select": [{ data: [], error: null }],
        "plan_revisions.insert": [{ data: null, error: null }],
        "plan_exercises.delete": [
          { data: null, error: null },
          { data: null, error: null },
        ],
        "plan_exercises.insert": [
          { data: null, error: { message: "edited insert failed" } },
          { data: null, error: { message: "original restore failed" } },
        ],
      },
      log,
    );

    await expect(
      applyPatchToPlan(supabase, editablePlan(), fourSetPatch, "athlete_direct", editLibrary),
    ).rejects.toThrow(/Rollback also failed:.*original restore failed/);
  });
});

/**
 * A revision store that actually mutates, so consecutive calls see each other.
 *
 * The fakes above serve a FIXED list, which is enough to prove what one call
 * does and nothing about what two calls do in sequence. That is the gap this
 * closes: the defect these tests exist for was specifically about the SECOND
 * press of Undo, and a fixed list cannot express a second press.
 */
function statefulSupabase(seed: { revision: number; snapshot: PlanWithDays }[]) {
  const rows = seed.map((r) => ({ ...r, summary: `change ${r.revision}` }));
  const plan: { last_reviewed_on: string | null } = { last_reviewed_on: null };

  const client = {
    rows,
    plan,
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let pending = "select";
      let revisionArg: number | undefined;
      let inserted: { revision?: number; snapshot?: PlanWithDays } | null = null;
      let limit = Infinity;

      const chain = () => builder;
      for (const m of ["select", "order"]) builder[m] = vi.fn(chain);
      builder.limit = vi.fn((n: number) => {
        limit = n;
        return builder;
      });
      builder.eq = vi.fn((column: string, value: unknown) => {
        if (column === "revision") revisionArg = value as number;
        return builder;
      });
      builder.delete = vi.fn(() => {
        pending = "delete";
        return builder;
      });
      builder.update = vi.fn((value: unknown) => {
        pending = "update";
        if (table === "training_plans") {
          const patch = value as { last_reviewed_on?: string | null };
          if ("last_reviewed_on" in patch) plan.last_reviewed_on = patch.last_reviewed_on ?? null;
        }
        return builder;
      });
      builder.insert = vi.fn((value: unknown) => {
        pending = "insert";
        inserted = value as { revision?: number; snapshot?: PlanWithDays };
        return builder;
      });

      const settle = () => {
        if (table === "plan_revisions") {
          if (pending === "delete" && revisionArg != null) {
            const at = rows.findIndex((r) => r.revision === revisionArg);
            if (at >= 0) rows.splice(at, 1);
            return Promise.resolve({ data: null, error: null });
          }
          if (pending === "insert" && inserted?.revision != null) {
            rows.push({
              revision: inserted.revision,
              snapshot: inserted.snapshot as PlanWithDays,
              summary: "inserted",
            });
            return Promise.resolve({ data: null, error: null });
          }
          if (pending === "select") {
            const sorted = rows.slice().sort((a, b) => b.revision - a.revision);
            return Promise.resolve({ data: sorted.slice(0, limit), error: null });
          }
        }
        return Promise.resolve({ data: null, error: null });
      };

      builder.then = (ok: (r: unknown) => unknown, err?: (e: unknown) => unknown) =>
        settle().then(ok, err);
      return builder;
    },
  };
  return client as unknown as SupabaseClient & { rows: typeof rows; plan: typeof plan };
}

describe("undo chains", () => {
  const three = () => [
    { revision: 0, snapshot: snapshot("Baseline") },
    { revision: 1, snapshot: snapshot("First") },
    { revision: 2, snapshot: snapshot("Second") },
  ];

  it("walks further back on every press, instead of toggling", async () => {
    // THE regression. Before the fix, undo appended the restored state, so the
    // second press found the undone change one row back and restored it. The
    // single-step test above cannot see that; only a chain can.
    const supabase = statefulSupabase(three());

    const first = await undoLastRevision(supabase, "p1");
    expect(first?.days[0].name).toBe("First");

    const second = await undoLastRevision(supabase, "p1");
    expect(second?.days[0].name).toBe("Baseline");
  });

  it("stops at the baseline instead of destroying it", async () => {
    const supabase = statefulSupabase(three());
    await undoLastRevision(supabase, "p1");
    await undoLastRevision(supabase, "p1");

    const third = await undoLastRevision(supabase, "p1");
    expect(third).toBeNull();
    // The baseline survives, so the plan can never be left with no history to
    // stand on.
    expect(supabase.rows.map((r) => r.revision)).toEqual([0]);
  });

  it("reuses the freed revision number without colliding after an undo", async () => {
    // nextRevision is latest + 1, and undo now deletes the latest, so numbers
    // are reused. Harmless only because the old row is gone. Pin it, because a
    // future change to either half would collide on the unique index.
    const supabase = statefulSupabase(three());
    await undoLastRevision(supabase, "p1");
    expect(supabase.rows.map((r) => r.revision)).toEqual([0, 1]);

    await supabase
      .from("plan_revisions")
      .insert({ plan_id: "p1", revision: 2, snapshot: snapshot("Third") });
    expect(supabase.rows.map((r) => r.revision).sort()).toEqual([0, 1, 2]);
  });
});

describe("undoing an accepted weekly review", () => {
  // Found against the live database, not by reading. Accepting a review stamps
  // last_reviewed_on on training_plans, which is not part of the ops, so
  // restoring days and exercises left the stamp behind. The plan reverted and
  // the athlete still could not ask for another proposal for a week, while the
  // done-state copy was telling them to undo if they did not like it.
  function reviewed(name: string, stamp: string | null): PlanWithDays {
    return { ...snapshot(name), last_reviewed_on: stamp };
  }

  it("gives the review back by restoring the stamp from the snapshot", async () => {
    const supabase = statefulSupabase([
      // Written before the stamp, so it carries the pre-review value.
      { revision: 0, snapshot: reviewed("Baseline", null) },
      { revision: 1, snapshot: reviewed("Reviewed", null) },
    ]);
    supabase.plan.last_reviewed_on = "2026-08-06";

    await undoLastRevision(supabase, "p1");

    expect(supabase.plan.last_reviewed_on).toBeNull();
  });

  it("restores an earlier review date rather than always clearing it", async () => {
    // An athlete on their second review should fall back to the first one's
    // date, not to never-reviewed.
    const supabase = statefulSupabase([
      { revision: 0, snapshot: reviewed("Baseline", "2026-07-30") },
      { revision: 1, snapshot: reviewed("Reviewed", "2026-07-30") },
    ]);
    supabase.plan.last_reviewed_on = "2026-08-06";

    await undoLastRevision(supabase, "p1");

    expect(supabase.plan.last_reviewed_on).toBe("2026-07-30");
  });
});
