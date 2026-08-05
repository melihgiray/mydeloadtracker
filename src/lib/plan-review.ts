// The weekly review: what actually happened against what the plan asked for.
//
// Step 7 of docs/PLANNER_V2_DESIGN.md. The founder's words were "not
// necessarily new exercises, just re-analysed", and that sentence sets the
// whole shape of this module. It reads adherence and hands the coach facts.
// It does not rebuild a plan, and it does not decide anything on its own.
//
// Everything here is pure, so the question "did this athlete progress on
// Squat" is answerable in a test without a database or a model.

import { localDateKey } from "@/lib/analytics/dates";
import { patchFootprint, type PlanOp } from "@/lib/plan-patch";
import type { PlanWithDays, TrainingSet } from "@/lib/types";

/** A plan week is seven days. Reviewing sooner has nothing new to read. */
export const REVIEW_INTERVAL_DAYS = 7;

/**
 * A patch touching more than this share of the plan is a rebuild wearing a
 * patch's clothes, and gets presented as one. Judgement, not measurement.
 */
export const BIG_CHANGE_SHARE = 1 / 3;

export type LiftTrend = "progressed" | "held" | "stalled" | "untrained";

export interface LiftReview {
  exerciseId: string;
  name: string;
  dayIndex: number;
  position: number;
  /** Sets the plan asked for this week. */
  setsPlanned: number;
  /** Sets actually logged in the window. */
  setsLogged: number;
  /** Heaviest working weight in the window, canonical kg, or null. */
  topWeight: number | null;
  /** The same figure from the window before it, for comparison. */
  priorTopWeight: number | null;
  /** Mean reported RPE in the window, or null when nobody reported one. */
  meanRpe: number | null;
  trend: LiftTrend;
}

export interface PlanReview {
  /** Inclusive start and exclusive end of the window, as date keys. */
  from: string;
  to: string;
  /** Distinct days trained in the window. */
  sessionsLogged: number;
  sessionsPlanned: number;
  lifts: LiftReview[];
  /** Planned exercises that saw no work at all this week. */
  untrained: LiftReview[];
  /** Lifts whose top weight fell or held while effort stayed high. */
  stalled: LiftReview[];
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function shiftDays(key: string, days: number): string {
  const t = Date.parse(`${key}T00:00:00Z`);
  return new Date(t + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Whether a review is due.
 *
 * Anchored to `last_reviewed_on` when there is one and to the plan's start date
 * otherwise, so a brand new plan is not reviewed before it has been trained.
 */
export function isReviewDue(
  plan: Pick<PlanWithDays, "started_on"> & { last_reviewed_on?: string | null },
  today: string = localDateKey(new Date()),
): boolean {
  const anchor = dayKey(plan.last_reviewed_on ?? plan.started_on);
  const elapsed = Math.floor(
    (Date.parse(`${dayKey(today)}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );
  return Number.isFinite(elapsed) && elapsed >= REVIEW_INTERVAL_DAYS;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compare last week against the week before it, per planned exercise.
 *
 * A lift is only called stalled when there is a prior week to compare against.
 * Without one there is no trend, just a first data point, and reporting one
 * would be inventing a comparison (golden rule 4).
 */
export function buildPlanReview(
  plan: PlanWithDays,
  sets: TrainingSet[],
  today: string = localDateKey(new Date()),
): PlanReview {
  const to = dayKey(today);
  const from = shiftDays(to, -REVIEW_INTERVAL_DAYS);
  const priorFrom = shiftDays(to, -REVIEW_INTERVAL_DAYS * 2);

  const inWindow = sets.filter((s) => dayKey(s.date) >= from && dayKey(s.date) < to);
  const inPrior = sets.filter((s) => dayKey(s.date) >= priorFrom && dayKey(s.date) < from);

  const lifts: LiftReview[] = [];
  for (const day of plan.days) {
    for (const planned of day.exercises) {
      const logged = inWindow.filter((s) => s.exerciseId === planned.exercise_id);
      const prior = inPrior.filter((s) => s.exerciseId === planned.exercise_id);
      const topWeight = logged.length ? Math.max(...logged.map((s) => s.weight)) : null;
      const priorTopWeight = prior.length ? Math.max(...prior.map((s) => s.weight)) : null;
      const meanRpe = mean(
        logged.map((s) => s.rpe).filter((r): r is number => r != null),
      );

      let trend: LiftTrend;
      if (logged.length === 0) {
        trend = "untrained";
      } else if (priorTopWeight == null || topWeight == null) {
        // First week on this lift. No comparison exists, so no claim is made.
        trend = "held";
      } else if (topWeight > priorTopWeight) {
        trend = "progressed";
      } else if (topWeight < priorTopWeight) {
        trend = "stalled";
      } else {
        // Same load two weeks running is only a stall if the effort was already
        // high. At a moderate RPE it is just a week that had room left in it.
        trend = meanRpe != null && meanRpe >= 9 ? "stalled" : "held";
      }

      lifts.push({
        exerciseId: planned.exercise_id,
        name: planned.name,
        dayIndex: day.day_index,
        position: planned.position,
        setsPlanned: planned.sets,
        setsLogged: logged.length,
        topWeight,
        priorTopWeight,
        meanRpe: meanRpe == null ? null : Math.round(meanRpe * 10) / 10,
        trend,
      });
    }
  }

  const sessionsLogged = new Set(inWindow.map((s) => dayKey(s.date))).size;

  return {
    from,
    to,
    sessionsLogged,
    sessionsPlanned: plan.days.length,
    lifts,
    untrained: lifts.filter((l) => l.trend === "untrained"),
    stalled: lifts.filter((l) => l.trend === "stalled"),
  };
}

/**
 * Whether a proposed patch is large enough to need explicit confirmation.
 *
 * The design's rule: a patch touching more than about a third of the plan is a
 * rebuild, and continuity is the point of a review.
 */
export function isBigChange(plan: PlanWithDays, ops: PlanOp[]): boolean {
  // patchFootprint already returns a share of the plan, not a count.
  return patchFootprint(plan, ops) > BIG_CHANGE_SHARE;
}

/**
 * The compact adherence summary the review prompt carries.
 *
 * Plain text rather than JSON: the model reads this as evidence about a person,
 * and the numbers are few enough that structure buys nothing.
 */
export function summariseReview(review: PlanReview): string {
  const lines: string[] = [
    `Week of ${review.from} to ${review.to}. Trained ${review.sessionsLogged} of ${review.sessionsPlanned} planned days.`,
  ];
  for (const lift of review.lifts) {
    const parts: string[] = [];
    if (lift.trend === "untrained") {
      parts.push("not trained this week");
    } else {
      parts.push(`${lift.setsLogged} of ${lift.setsPlanned} sets`);
      if (lift.topWeight != null) {
        parts.push(
          lift.priorTopWeight != null
            ? `top ${lift.topWeight}kg vs ${lift.priorTopWeight}kg last week`
            : `top ${lift.topWeight}kg, no prior week`,
        );
      }
      if (lift.meanRpe != null) parts.push(`mean RPE ${lift.meanRpe}`);
      parts.push(lift.trend);
    }
    lines.push(
      `[day ${lift.dayIndex} position ${lift.position}] ${lift.name}: ${parts.join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * The weekly review prompt.
 *
 * Shares the ops schema and the parser with the chat route, because a review is
 * the same kind of change as an edit, just triggered by the calendar instead of
 * by the athlete typing. The rules that differ are all about restraint.
 */
export function buildWeeklyReviewPrompt(
  plan: PlanWithDays,
  review: PlanReview,
  exercises: { reference: string; exercise: { name: string; muscle_group: string } }[],
  weakPointSummary: string[],
): string {
  return `You are the athlete's strength coach, looking at how their week went. Adjust their plan for next week.

Rules:
1. ADJUST, DO NOT REBUILD. Continuity is the point. Most weeks need one to three ops, and a week that went well needs none at all. Returning no ops is a good answer.
2. A lift that progressed is working. Leave it alone, or add load by raising the rep range only if they are at the top of it.
3. A lift that stalled two weeks running needs a change: a different rep range, or a swap to a close variant. Do not swap on one bad week.
4. A lift they did not train once is a signal about the plan, not about them. If a whole day was missed, say so and consider proposing fewer days rather than pretending the day exists.
5. Never add volume to a muscle that is already leading while one is lagging.
6. Address exercises by dayIndex and position, exactly as they appear below.
7. exerciseRef must be a reference such as e14 from the exercises list. Never a name, never a database id.
8. Every op needs a reason: one short sentence naming the evidence, for example "you hit 65kg twice, so the range moves up".
9. Never place an isolation movement immediately before a compound that works the same muscle.
10. Do not invent numbers. If a lift has no prior week, say there is nothing to compare yet.
11. Write like a human. Never use em dashes, en dashes, or any dash as punctuation. Use commas and periods. No exclamation points. No markdown.

The reply is what they read first. Two or three sentences on how the week actually went, then what you changed.

CURRENT_PLAN
${JSON.stringify(
  {
    name: plan.name,
    goal: plan.goal,
    trainingStyle: plan.training_style,
    days: plan.days.map((d) => ({
      dayIndex: d.day_index,
      name: d.name,
      exercises: d.exercises.map((e) => ({
        position: e.position,
        name: e.name,
        muscle: e.muscle_group,
        sets: e.sets,
        reps: `${e.rep_low}-${e.rep_high}`,
        rpe: e.rpe_target,
      })),
    })),
  },
  null,
  2,
)}

WHAT_HAPPENED_LAST_WEEK
${summariseReview(review)}

WHAT_THE_APP_KNOWS_ABOUT_THEM
${weakPointSummary.length ? weakPointSummary.join("\n") : "Not enough logged history to assess muscle balance yet."}

AVAILABLE_EXERCISES
${JSON.stringify(
  exercises.map((r) => ({ id: r.reference, name: r.exercise.name, muscle: r.exercise.muscle_group })),
)}`;
}
