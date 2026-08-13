// Conversational plan intake — turning "I want to get stronger, 4 days a week,
// I've got a barbell and dumbbells" into the structured PlanIntake the generator
// (/api/plan) already understands. The model extracts fields into a tool call;
// this parses that raw output the same way parseCoachTurn does: a trust
// boundary, nothing invalid reaches the generator.

import type { PlanGoal } from "@/lib/types";
import {
  EQUIPMENT_TAGS,
  type EquipmentTag,
  type SplitPreference,
  type PlanIntake,
} from "@/lib/plan-generation";
import { type TrainingStyle } from "@/lib/training-style";

const GOALS: PlanGoal[] = ["hypertrophy", "strength", "both"];
const SPLITS: SplitPreference[] = ["auto", "upper_lower", "ppl", "full_body", "arnold", "custom"];
const STYLES: TrainingStyle[] = ["few_hard", "balanced", "more_volume"];

/** The fields the generator truly needs before it can build anything. */
export const INTAKE_ESSENTIALS = ["goal", "daysPerWeek", "equipment"] as const;

export interface IntakeTurn {
  /** What the coach says back: a follow-up question, or a confirmation. */
  reply: string;
  /** The fields understood from THIS turn (merged into the running intake by the caller). */
  intake: Partial<PlanIntake>;
  /** The model's own read on whether it has enough to build. */
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

  const reply = typeof o.reply === "string" ? o.reply.trim().slice(0, 600) : "";
  return { reply, intake, modelReady: o.ready === true };
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
