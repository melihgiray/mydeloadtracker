import { planCycleWeek } from "@/lib/plans";
import type { PlanDayWithExercises, PlanWithDays } from "@/lib/types";

const MAX_DAYS = 7;
const MAX_EXERCISES_PER_DAY = 12;

function compact(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function exercisePrescription(
  exercise: PlanDayWithExercises["exercises"][number],
): string {
  const details = [
    `${exercise.sets} sets of ${exercise.rep_low} to ${exercise.rep_high} reps`,
    exercise.rpe_target != null ? `RPE ${exercise.rpe_target}` : null,
    exercise.rest_seconds != null ? `${exercise.rest_seconds} seconds rest` : null,
    exercise.role,
    exercise.note?.trim() ? `note: ${compact(exercise.note, 120)}` : null,
  ].filter(Boolean);

  return `${compact(exercise.name, 80)} (${details.join(", ")})`;
}

/**
 * Compact current-program memory for the general Coach.
 *
 * The active plan can contain seven days with twelve exercises each. Keep the
 * complete valid shape, but bound every free-text field so a malformed row
 * cannot crowd the athlete's training history out of the model context.
 */
export function summariseActivePlan(
  plan: PlanWithDays,
  currentDay: PlanDayWithExercises,
  today: string,
): string {
  const cycleWeek = planCycleWeek(plan.started_on, plan.mesocycle_weeks, today);
  const deload =
    plan.deload_week != null
      ? ` Deload is scheduled for week ${plan.deload_week}.`
      : " No deload week is scheduled.";
  const style = plan.training_style?.trim()
    ? ` Training style: ${compact(plan.training_style, 160)}.`
    : "";
  const constraints = [
    plan.equipment.length > 0
      ? `Equipment: ${plan.equipment.slice(0, 12).map((item) => compact(item, 40)).join(", ")}.`
      : null,
    plan.avoid.length > 0
      ? `Avoid: ${plan.avoid.slice(0, 12).map((item) => compact(item, 80)).join(", ")}.`
      : null,
  ].filter(Boolean);

  const days = plan.days.slice(0, MAX_DAYS).map((day, index) => {
    const marker = day.id === currentDay.id ? " Current rotation day." : "";
    const focus = day.focus?.trim() ? ` Focus: ${compact(day.focus, 120)}.` : "";
    const exercises = day.exercises
      .slice(0, MAX_EXERCISES_PER_DAY)
      .map(exercisePrescription)
      .join("; ");
    return `Day ${index + 1}, ${compact(day.name, 80)}.${marker}${focus} ${exercises || "No exercises."}`;
  });

  return [
    "=== ACTIVE TRAINING PLAN ===",
    `Plan: ${compact(plan.name, 100)}. Goal: ${plan.goal}. Split: ${plan.split}. ${plan.days_per_week} days per week.`,
    `Cycle: week ${cycleWeek} of ${plan.mesocycle_weeks}.${deload}${style}`,
    ...constraints,
    ...days,
  ].join("\n");
}
