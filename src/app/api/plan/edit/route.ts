// Apply a patch to the active plan.
//
// One apply path for every way a plan can change by hand: the weekly review's
// Accept button, and the direct tap-to-edit controls on the plan itself. Both
// go through the same engine, the same revision history, and the same undo.
// A second apply path would be a second place for the two to drift.
//
// The chat route stays separate because it also talks to the model. What
// happens AFTER the ops exist is identical, and that part lives in
// applyPatchToPlan, not here.

import { NextResponse } from "next/server";
import { getExercises } from "@/lib/data";
import { localDateKey } from "@/lib/analytics/dates";
import { applyPatchToPlan } from "@/lib/plan-edit";
import type { PlanOp, PlanOpSource } from "@/lib/plan-patch";
import {
  EQUIPMENT_TAGS,
  filterExercisesForEquipment,
  type EquipmentTag,
} from "@/lib/plan-generation";
import { getActivePlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** How the ops arrived, which is what the revision history records. */
const SOURCES: PlanOpSource[] = ["athlete_direct", "weekly_review"];

const OP_KINDS = new Set([
  "replace_exercise",
  "remove_exercise",
  "insert_exercise",
  "set_prescription",
  "reorder",
  "rename_day",
]);

function int(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

/**
 * Ops arrive from a client, so nothing is trusted.
 *
 * This checks shape only. Whether an exercise exists, is visible, and sits at
 * the position named is the patch engine's job, and it already reports each
 * rejection with a reason the athlete reads.
 */
function parseOps(raw: unknown): PlanOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) return null;
  const ops: PlanOp[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    if (typeof o.op !== "string" || !OP_KINDS.has(o.op)) return null;
    const dayIndex = int(o.dayIndex);
    if (dayIndex == null || dayIndex < 0 || dayIndex > 6) return null;
    const reason =
      typeof o.reason === "string" && o.reason.trim() ? o.reason.trim().slice(0, 200) : null;
    if (!reason) return null;
    ops.push({ ...(o as unknown as PlanOp), dayIndex, reason });
  }
  return ops;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { ops?: unknown; source?: unknown; dismiss?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const source: PlanOpSource = SOURCES.includes(body.source as PlanOpSource)
    ? (body.source as PlanOpSource)
    : "athlete_direct";

  try {
    const plan = await getActivePlan(supabase);
    if (!plan) {
      return NextResponse.json({ error: "You do not have an active plan yet." }, { status: 404 });
    }

    // Dismissing a review changes nothing but still counts as reviewed, so the
    // prompt does not reappear on the next screen the athlete opens.
    if (body.dismiss === true) {
      await supabase
        .from("training_plans")
        .update({ last_reviewed_on: localDateKey(new Date()) })
        .eq("id", plan.id);
      return NextResponse.json({ applied: [], rejected: [], revision: null, dismissed: true });
    }

    const ops = parseOps(body.ops);
    if (!ops) return NextResponse.json({ error: "Those changes were not readable." }, { status: 400 });

    // The equipment guarantee has to hold no matter what the client sent, not
    // only when the client filtered its own picker.
    const library = await getExercises(supabase);
    const equipment = plan.equipment.filter((e): e is EquipmentTag =>
      (EQUIPMENT_TAGS as readonly string[]).includes(e),
    );
    const available = filterExercisesForEquipment(library, equipment);

    const result = await applyPatchToPlan(supabase, plan, ops, source, available);

    // Only a review that actually changed something counts as used. If every
    // op was rejected the plan is untouched, so the athlete keeps their week
    // and can run it again. Dismissing is handled above and always counts.
    if (source === "weekly_review" && result.applied.length > 0) {
      await supabase
        .from("training_plans")
        .update({ last_reviewed_on: localDateKey(new Date()) })
        .eq("id", plan.id);
    }

    return NextResponse.json({
      applied: result.applied.map((o) => ({ op: o.op, dayIndex: o.dayIndex, reason: o.reason })),
      rejected: result.rejected.map((r) => ({ reason: r.op.reason, error: r.error })),
      revision: result.revision,
      summary: result.summary,
    });
  } catch (error) {
    console.error("Plan edit error:", error);
    return NextResponse.json({ error: "Those changes could not be saved." }, { status: 502 });
  }
}
