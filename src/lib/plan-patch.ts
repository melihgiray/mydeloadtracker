// Applying a change to a plan, as a list of operations.
//
// Step 2 of docs/PLANNER_V2_DESIGN.md, and the foundation for steps 6 and 7:
// a tap in the UI, a sentence to the coach, and the weekly review all produce
// the same ops and go through this one function. Only the source differs.
//
// WHY OPS AND NOT A WHOLE PLAN
//
// v1 could only replace a plan, which meant a full regeneration measured at 35
// seconds and about 3000 output tokens to change one exercise. It also threw
// away everything the athlete had already accepted. An op is a few hundred
// bytes, applies instantly, and preserves the rest of the plan by construction.
//
// TWO RULES THAT MATTER
//
// 1. Nothing is ever silently dropped. An op that cannot apply comes back in
//    `rejected` with the reason, and the caller shows it. A patch that quietly
//    ignores half its instructions is worse than one that fails.
// 2. Every op carries a `reason`. A coach that changes something without
//    saying why is not a coach, and the reason is shown in the UI and stored
//    in the revision history.
//
// Pure. No database, no network, no React.

import type { Exercise, PlanDayWithExercises, PlanWithDays } from "@/lib/types";

export type PlanOpSource = "athlete_direct" | "athlete_chat" | "weekly_review";

export type PlanOp =
  | { op: "replace_exercise"; dayIndex: number; position: number; exerciseId: string; reason: string }
  | { op: "remove_exercise"; dayIndex: number; position: number; reason: string }
  | {
      op: "insert_exercise";
      dayIndex: number;
      position: number;
      exerciseId: string;
      sets: number;
      repLow: number;
      repHigh: number;
      rpeTarget?: number | null;
      restSeconds?: number | null;
      reason: string;
    }
  | {
      op: "set_prescription";
      dayIndex: number;
      position: number;
      sets?: number;
      repLow?: number;
      repHigh?: number;
      rpeTarget?: number | null;
      restSeconds?: number | null;
      reason: string;
    }
  | { op: "reorder"; dayIndex: number; fromPosition: number; toPosition: number; reason: string }
  | { op: "rename_day"; dayIndex: number; name?: string; focus?: string | null; reason: string };

export interface RejectedOp {
  op: PlanOp;
  /** Why it could not apply, in words an athlete can read. */
  error: string;
}

export interface PatchResult {
  /** The plan after every applicable op. Never mutated in place. */
  plan: PlanWithDays;
  applied: PlanOp[];
  rejected: RejectedOp[];
}

/** Mirrors the check constraints in migration 0016, so the database never sees a violation. */
const LIMITS = {
  sets: { min: 1, max: 12 },
  reps: { min: 1, max: 100 },
  rpe: { min: 5, max: 10 },
  rest: { min: 15, max: 600 },
  exercisesPerDay: { min: 1, max: 12 },
} as const;

const clone = (plan: PlanWithDays): PlanWithDays => ({
  ...plan,
  days: plan.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })),
});

/**
 * Positions must stay contiguous from zero, because migration 0016 puts a
 * unique index on (plan_day_id, position). Any op that adds, removes or moves
 * runs this afterwards rather than trying to keep the numbering right inline.
 */
const renumber = (day: PlanDayWithExercises): void => {
  day.exercises.forEach((e, i) => {
    e.position = i;
  });
};

function inRange(value: number, { min, max }: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Apply a list of ops to a plan.
 *
 * Ops are applied in order and each sees the result of the previous one, which
 * is what makes "remove exercise 2, then insert a new one at 2" mean what it
 * reads like. A rejected op does not stop the ones after it: the athlete gets
 * everything that could be done, plus a list of what could not.
 */
export function applyPlanPatch(
  plan: PlanWithDays,
  ops: PlanOp[],
  library: Exercise[],
): PatchResult {
  const next = clone(plan);
  const byId = new Map(library.map((e) => [e.id, e]));
  const applied: PlanOp[] = [];
  const rejected: RejectedOp[] = [];

  for (const op of ops) {
    const day = next.days[op.dayIndex];
    if (!day) {
      rejected.push({ op, error: `There is no day ${op.dayIndex + 1} in this plan.` });
      continue;
    }

    const reject = (error: string) => rejected.push({ op, error });

    switch (op.op) {
      case "rename_day": {
        if (op.name !== undefined) {
          const name = op.name.trim();
          if (!name) {
            reject("A day needs a name.");
            break;
          }
          day.name = name.slice(0, 80);
        }
        if (op.focus !== undefined) {
          day.focus = op.focus === null ? null : op.focus.trim().slice(0, 160) || null;
        }
        applied.push(op);
        break;
      }

      case "remove_exercise": {
        if (!day.exercises[op.position]) {
          reject("That exercise is no longer in the day.");
          break;
        }
        // A day with nothing in it is not a day. The athlete should remove the
        // day itself, which is a bigger decision than removing a lift.
        if (day.exercises.length <= LIMITS.exercisesPerDay.min) {
          reject(`${day.name} would be left empty. Remove the day instead.`);
          break;
        }
        day.exercises.splice(op.position, 1);
        renumber(day);
        applied.push(op);
        break;
      }

      case "replace_exercise": {
        const target = day.exercises[op.position];
        if (!target) {
          reject("That exercise is no longer in the day.");
          break;
        }
        const replacement = byId.get(op.exerciseId);
        if (!replacement) {
          reject("That exercise is not in the library.");
          break;
        }
        if (replacement.hidden) {
          reject(`${replacement.name} is retired and cannot be added to a plan.`);
          break;
        }
        if (day.exercises.some((e, i) => i !== op.position && e.exercise_id === op.exerciseId)) {
          reject(`${replacement.name} is already in ${day.name}.`);
          break;
        }
        // Keep the prescription, swap the movement. Someone swapping a lift is
        // changing what they do, not how much of it.
        target.exercise_id = replacement.id;
        target.name = replacement.name;
        target.muscle_group = replacement.muscle_group;
        target.equipment = replacement.equipment;
        applied.push(op);
        break;
      }

      case "insert_exercise": {
        const exercise = byId.get(op.exerciseId);
        if (!exercise) {
          reject("That exercise is not in the library.");
          break;
        }
        if (exercise.hidden) {
          reject(`${exercise.name} is retired and cannot be added to a plan.`);
          break;
        }
        if (day.exercises.some((e) => e.exercise_id === op.exerciseId)) {
          reject(`${exercise.name} is already in ${day.name}.`);
          break;
        }
        if (day.exercises.length >= LIMITS.exercisesPerDay.max) {
          reject(`${day.name} already has ${LIMITS.exercisesPerDay.max} exercises.`);
          break;
        }
        if (!inRange(op.sets, LIMITS.sets)) {
          reject(`Sets must be between ${LIMITS.sets.min} and ${LIMITS.sets.max}.`);
          break;
        }
        if (!inRange(op.repLow, LIMITS.reps) || !inRange(op.repHigh, LIMITS.reps)) {
          reject(`Reps must be between ${LIMITS.reps.min} and ${LIMITS.reps.max}.`);
          break;
        }
        if (op.repHigh < op.repLow) {
          reject("The rep range runs backwards.");
          break;
        }
        // Clamped rather than rejected: an out-of-bounds insert position is a
        // caller bug, not something the athlete did wrong, and the intent is
        // obvious.
        const at = Math.max(0, Math.min(op.position, day.exercises.length));
        day.exercises.splice(at, 0, {
          // The database assigns the real id on insert. Callers persisting this
          // must treat a `new:` id as "create me".
          id: `new:${op.exerciseId}:${at}`,
          plan_day_id: day.id,
          exercise_id: exercise.id,
          position: at,
          sets: op.sets,
          rep_low: op.repLow,
          rep_high: op.repHigh,
          rpe_target: op.rpeTarget ?? null,
          rest_seconds: op.restSeconds ?? null,
          role: null,
          note: null,
          name: exercise.name,
          muscle_group: exercise.muscle_group,
          equipment: exercise.equipment,
        });
        renumber(day);
        applied.push(op);
        break;
      }

      case "set_prescription": {
        const target = day.exercises[op.position];
        if (!target) {
          reject("That exercise is no longer in the day.");
          break;
        }
        const sets = op.sets ?? target.sets;
        const repLow = op.repLow ?? target.rep_low;
        const repHigh = op.repHigh ?? target.rep_high;
        if (!inRange(sets, LIMITS.sets)) {
          reject(`Sets must be between ${LIMITS.sets.min} and ${LIMITS.sets.max}.`);
          break;
        }
        if (!inRange(repLow, LIMITS.reps) || !inRange(repHigh, LIMITS.reps)) {
          reject(`Reps must be between ${LIMITS.reps.min} and ${LIMITS.reps.max}.`);
          break;
        }
        if (repHigh < repLow) {
          reject("The rep range runs backwards.");
          break;
        }
        if (op.rpeTarget != null && !inRange(op.rpeTarget, LIMITS.rpe)) {
          reject(`RPE must be between ${LIMITS.rpe.min} and ${LIMITS.rpe.max}.`);
          break;
        }
        if (op.restSeconds != null && !inRange(op.restSeconds, LIMITS.rest)) {
          reject(`Rest must be between ${LIMITS.rest.min} and ${LIMITS.rest.max} seconds.`);
          break;
        }
        target.sets = sets;
        target.rep_low = repLow;
        target.rep_high = repHigh;
        if (op.rpeTarget !== undefined) target.rpe_target = op.rpeTarget;
        if (op.restSeconds !== undefined) target.rest_seconds = op.restSeconds;
        applied.push(op);
        break;
      }

      case "reorder": {
        const { fromPosition, toPosition } = op;
        if (!day.exercises[fromPosition]) {
          reject("That exercise is no longer in the day.");
          break;
        }
        if (fromPosition === toPosition) {
          reject("That exercise is already there.");
          break;
        }
        const to = Math.max(0, Math.min(toPosition, day.exercises.length - 1));
        const [moved] = day.exercises.splice(fromPosition, 1);
        day.exercises.splice(to, 0, moved);
        renumber(day);
        applied.push(op);
        break;
      }
    }
  }

  return { plan: next, applied, rejected };
}

/** One short sentence describing a patch, for the revision history. */
export function summarisePatch(applied: PlanOp[]): string {
  if (applied.length === 0) return "No changes.";
  if (applied.length === 1) return applied[0].reason;
  return `${applied.length} changes: ${applied.map((o) => o.reason).join(" ")}`.slice(0, 300);
}

/**
 * How much of the plan a patch touches, as a fraction of its exercises.
 *
 * The design calls for a patch that changes more than about a third of a plan
 * to be presented as a big change and confirmed explicitly. The founder asked
 * for weekly review to adjust rather than rebuild, and this is how that gets
 * enforced rather than hoped for.
 */
export function patchFootprint(plan: PlanWithDays, ops: PlanOp[]): number {
  const total = plan.days.reduce((n, d) => n + d.exercises.length, 0);
  if (total === 0) return 0;
  const touched = new Set(
    ops
      .filter((o) => o.op !== "rename_day")
      .map((o) => `${o.dayIndex}:${"position" in o ? o.position : (o as { fromPosition: number }).fromPosition}`),
  );
  return touched.size / total;
}
