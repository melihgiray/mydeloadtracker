import { applyPlanPatch, type PlanOp, type RejectedOp } from "@/lib/plan-patch";
import type { Exercise, PlanWithDays } from "@/lib/types";

export interface PlanActionPreview {
  title: string;
  before: string | null;
  after: string | null;
  reason: string;
}

export interface PlanActionPreviewResult {
  plan: PlanWithDays;
  applied: PlanOp[];
  rejected: RejectedOp[];
  changes: PlanActionPreview[];
}

function prescription(exercise: PlanWithDays["days"][number]["exercises"][number]): string {
  const reps =
    exercise.rep_low === exercise.rep_high
      ? `${exercise.rep_low} reps`
      : `${exercise.rep_low} to ${exercise.rep_high} reps`;
  const effort = exercise.rpe_target != null ? `, RPE ${exercise.rpe_target}` : "";
  return `${exercise.sets} sets, ${reps}${effort}`;
}

function describeAppliedOp(
  before: PlanWithDays,
  after: PlanWithDays,
  op: PlanOp,
): PlanActionPreview {
  const beforeDay = before.days[op.dayIndex];
  const afterDay = after.days[op.dayIndex];
  const fallback = { title: "Update plan", before: null, after: null, reason: op.reason };
  if (!beforeDay || !afterDay) return fallback;

  switch (op.op) {
    case "replace_exercise": {
      const oldExercise = beforeDay.exercises[op.position];
      const newExercise = afterDay.exercises[op.position];
      return {
        title: `Swap an exercise in ${afterDay.name}`,
        before: oldExercise?.name ?? null,
        after: newExercise?.name ?? null,
        reason: op.reason,
      };
    }
    case "remove_exercise": {
      const removed = beforeDay.exercises[op.position];
      return {
        title: `Remove an exercise from ${beforeDay.name}`,
        before: removed ? `${removed.name}, ${prescription(removed)}` : null,
        after: null,
        reason: op.reason,
      };
    }
    case "insert_exercise": {
      const added = afterDay.exercises.find((exercise) => exercise.exercise_id === op.exerciseId);
      return {
        title: `Add an exercise to ${afterDay.name}`,
        before: null,
        after: added ? `${added.name}, ${prescription(added)}` : null,
        reason: op.reason,
      };
    }
    case "set_prescription": {
      const oldExercise = beforeDay.exercises[op.position];
      const newExercise = afterDay.exercises[op.position];
      return {
        title: `Update ${newExercise?.name ?? "exercise"} in ${afterDay.name}`,
        before: oldExercise ? prescription(oldExercise) : null,
        after: newExercise ? prescription(newExercise) : null,
        reason: op.reason,
      };
    }
    case "reorder": {
      const moved = beforeDay.exercises[op.fromPosition];
      const newPosition = afterDay.exercises.findIndex(
        (exercise) => exercise.exercise_id === moved?.exercise_id,
      );
      return {
        title: `Move ${moved?.name ?? "exercise"} in ${afterDay.name}`,
        before: `Position ${op.fromPosition + 1}`,
        after: newPosition >= 0 ? `Position ${newPosition + 1}` : null,
        reason: op.reason,
      };
    }
    case "rename_day":
      return {
        title: "Rename a training day",
        before: beforeDay.name,
        after: afterDay.name,
        reason: op.reason,
      };
  }
}

/** Validate proposed actions and describe their exact before and after states. */
export function previewPlanActions(
  plan: PlanWithDays,
  ops: PlanOp[],
  library: Exercise[],
): PlanActionPreviewResult {
  let current = plan;
  const applied: PlanOp[] = [];
  const rejected: RejectedOp[] = [];
  const changes: PlanActionPreview[] = [];

  for (const op of ops) {
    const result = applyPlanPatch(current, [op], library);
    if (result.applied.length === 0) {
      rejected.push(...result.rejected);
      continue;
    }
    changes.push(describeAppliedOp(current, result.plan, op));
    applied.push(op);
    current = result.plan;
  }

  return { plan: current, applied, rejected, changes };
}
