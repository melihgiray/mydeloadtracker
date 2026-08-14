// Conversational plan intake — turning "I want to get stronger, 4 days a week,
// I've got a barbell and dumbbells" into the structured PlanIntake the generator
// (/api/plan) already understands. The model extracts fields into a tool call;
// this parses that raw output the same way parseCoachTurn does: a trust
// boundary, nothing invalid reaches the generator.

import type { Exercise, PlanGoal } from "@/lib/types";
import {
  EQUIPMENT_TAGS,
  type EquipmentTag,
  type SplitPreference,
  type PlanIntake,
} from "@/lib/plan-generation";
import { type TrainingStyle } from "@/lib/training-style";
import { aliasesFor } from "@/lib/exercise-aliases";

const GOALS: PlanGoal[] = ["hypertrophy", "strength", "both"];
const SPLITS: SplitPreference[] = ["auto", "upper_lower", "ppl", "full_body", "arnold", "custom"];
const STYLES: TrainingStyle[] = ["few_hard", "balanced", "more_volume"];

/** The fields the generator truly needs before it can build anything. */
export const INTAKE_ESSENTIALS = ["goal", "daysPerWeek", "equipment"] as const;

/** A lift as the model reported it, before it is matched to the library. */
export interface RawLift {
  exercise: string;
  weight: number;
  reps: number;
}

/** A lift matched to a real library exercise, ready to save as an athlete lift. */
export interface ResolvedLift {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  /** In the athlete's display unit, exactly as spoken. Converted to kg on save. */
  weight: number;
  reps: number;
}

export interface IntakeTurn {
  /** What the coach says back: a follow-up question, or a confirmation. */
  reply: string;
  /** The fields understood from THIS turn (merged into the running intake by the caller). */
  intake: Partial<PlanIntake>;
  /** Current lifts the athlete has named so far, unmatched to the library yet. */
  lifts: RawLift[];
  /** The model's own read on whether it has interviewed enough to build. */
  modelReady: boolean;
}

/** The tool the model fills in. Every field is optional; the coach gathers them over the turns. */
export const PLAN_INTAKE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "ready"],
  properties: {
    reply: {
      type: "string",
      description:
        "What you say to the athlete: one or two warm, plain sentences. If something essential is still missing (goal, days per week, or equipment), ask for just that. If you have enough, confirm what you heard in a sentence.",
    },
    ready: {
      type: "boolean",
      description: "true only when goal, days per week, and equipment are all known.",
    },
    goal: { type: ["string", "null"], enum: [...GOALS, null] },
    daysPerWeek: { type: ["integer", "null"], minimum: 1, maximum: 7 },
    sessionMinutes: { type: ["integer", "null"], minimum: 20, maximum: 180 },
    equipment: { type: "array", items: { type: "string", enum: [...EQUIPMENT_TAGS] } },
    splitPreference: { type: ["string", "null"], enum: [...SPLITS, null] },
    trainingStyle: { type: ["string", "null"], enum: [...STYLES, null] },
    avoid: {
      type: "array",
      items: { type: "string" },
      description: "Exercises or movements the athlete wants to avoid (injuries, dislikes).",
    },
    lifts: {
      type: "array",
      description:
        "Every current lift the athlete has told you about, each with a recent hard working set. Re-list ALL of them every turn, not just the newest, because this replaces the running list. Use plain lift names like 'Barbell Curl', 'Romanian Deadlift', 'Lat Pulldown'. Weights are in the athlete's own unit.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["exercise", "weight", "reps"],
        properties: {
          exercise: { type: "string", description: "The lift name, for example 'Bench Press'." },
          weight: { type: "number", description: "Weight of one hard set, in the athlete's unit." },
          reps: { type: "integer", minimum: 1, maximum: 100, description: "Reps at that weight." },
        },
      },
    },
    note: { type: ["string", "null"], description: "Any other context worth passing to the plan." },
  },
} as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function intInRange(value: unknown, lo: number, hi: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= lo && (value as number) <= hi
    ? (value as number)
    : undefined;
}

/** Parse the model's raw tool output into a validated partial intake. */
export function parseIntakeTurn(raw: unknown): IntakeTurn {
  const o = (raw ?? {}) as Record<string, unknown>;
  const intake: Partial<PlanIntake> = {};

  const goal = oneOf(o.goal, GOALS);
  if (goal) intake.goal = goal;

  const days = intInRange(o.daysPerWeek, 1, 7);
  if (days != null) intake.daysPerWeek = days;

  const minutes = intInRange(o.sessionMinutes, 20, 180);
  if (minutes != null) intake.sessionMinutes = minutes;

  if (Array.isArray(o.equipment)) {
    const eq = [...new Set(o.equipment.filter((e): e is EquipmentTag =>
      typeof e === "string" && (EQUIPMENT_TAGS as readonly string[]).includes(e),
    ))];
    if (eq.length) intake.equipment = eq;
  }

  const split = oneOf(o.splitPreference, SPLITS);
  if (split) intake.splitPreference = split;

  const style = oneOf(o.trainingStyle, STYLES);
  if (style) intake.trainingStyle = style;

  if (Array.isArray(o.avoid)) {
    const avoid = o.avoid
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim().slice(0, 60))
      .slice(0, 12);
    if (avoid.length) intake.avoid = avoid;
  }

  if (typeof o.note === "string" && o.note.trim()) intake.note = o.note.trim().slice(0, 300);

  const lifts: RawLift[] = [];
  if (Array.isArray(o.lifts)) {
    for (const item of o.lifts.slice(0, 30)) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      if (
        typeof c.exercise === "string" &&
        c.exercise.trim().length > 0 &&
        typeof c.weight === "number" &&
        typeof c.reps === "number"
      ) {
        lifts.push({ exercise: c.exercise.trim().slice(0, 60), weight: c.weight, reps: c.reps });
      }
    }
  }

  const reply = typeof o.reply === "string" ? o.reply.trim().slice(0, 600) : "";
  return { reply, intake, lifts, modelReady: o.ready === true };
}

const normalizeLiftName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Match the lifts the coach captured to real library exercises, so they can be
 * saved as athlete lifts and feed the weak-point assessment. A lift name that
 * does not resolve is dropped rather than guessed at (golden rule 4), and only
 * a valid weight and rep count survive. First mention of a given exercise wins,
 * which is correct because the model re-lists the whole set every turn.
 */
export function resolveInterviewLifts(raw: RawLift[], library: Exercise[]): ResolvedLift[] {
  const visible = library.filter((e) => !e.hidden);
  const byName = new Map(visible.map((e) => [normalizeLiftName(e.name), e]));
  const byAlias = new Map<string, Exercise>();
  for (const e of visible) {
    for (const alias of aliasesFor(e.name)) {
      const key = normalizeLiftName(alias);
      if (!byAlias.has(key)) byAlias.set(key, e);
    }
  }

  const resolved: ResolvedLift[] = [];
  const seen = new Set<string>();
  for (const lift of raw) {
    const key = normalizeLiftName(lift.exercise);
    const exercise = byName.get(key) ?? byAlias.get(key);
    if (!exercise || seen.has(exercise.id)) continue;
    if (!Number.isFinite(lift.weight) || lift.weight <= 0) continue;
    if (!Number.isInteger(lift.reps) || lift.reps < 1 || lift.reps > 100) continue;
    seen.add(exercise.id);
    resolved.push({
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscle_group,
      weight: lift.weight,
      reps: lift.reps,
    });
  }
  return resolved;
}

/** Which essentials are still missing from an accumulated intake. */
export function missingEssentials(intake: Partial<PlanIntake>): string[] {
  const missing: string[] = [];
  if (!intake.goal) missing.push("goal");
  if (intake.daysPerWeek == null) missing.push("daysPerWeek");
  if (!intake.equipment || intake.equipment.length === 0) missing.push("equipment");
  return missing;
}

/** Fill an accumulated intake with safe defaults for the non-essential fields. */
export function completeIntake(intake: Partial<PlanIntake>): PlanIntake | null {
  if (missingEssentials(intake).length > 0) return null;
  return {
    daysPerWeek: intake.daysPerWeek!,
    sessionMinutes: intake.sessionMinutes ?? 60,
    equipment: intake.equipment!,
    goal: intake.goal!,
    avoid: intake.avoid ?? [],
    splitPreference: intake.splitPreference ?? "auto",
    trainingStyle: intake.trainingStyle ?? null,
    note: intake.note ?? null,
  };
}
