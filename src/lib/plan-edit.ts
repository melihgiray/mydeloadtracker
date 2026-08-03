// Persisting a plan patch, and undoing one.
//
// Step 2 of docs/PLANNER_V2_DESIGN.md. The pure half lives in plan-patch.ts;
// this is the part that touches the database. Every edit path goes through
// here: a tap, a sentence to the coach, or the weekly review. Only `source`
// differs, which is what makes the revision history readable later.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActivePlan } from "@/lib/plans";
import {
  applyPlanPatch,
  summarisePatch,
  type PlanOp,
  type PlanOpSource,
  type RejectedOp,
} from "@/lib/plan-patch";
import type { Exercise, PlanWithDays } from "@/lib/types";

export interface EditResult {
  plan: PlanWithDays;
  applied: PlanOp[];
  rejected: RejectedOp[];
  /** Revision number written, or null when nothing applied. */
  revision: number | null;
  summary: string;
}

/**
 * Rewrite one day's exercises wholesale.
 *
 * Delete then insert rather than a careful diff of updates. Migration 0016 puts
 * a unique index on (plan_day_id, position), so moving an exercise from slot 2
 * to slot 0 by UPDATE collides with whatever is already in slot 0 partway
 * through. Replacing the day sidesteps ordering entirely, and a day is at most
 * twelve rows.
 *
 * The plan_exercises id is not referenced by anything else, so discarding it
 * costs nothing. Logged sets point at exercise_id, not at the plan row.
 */
async function rewriteDay(
  supabase: SupabaseClient,
  day: PlanWithDays["days"][number],
): Promise<void> {
  const { error: delErr } = await supabase
    .from("plan_exercises")
    .delete()
    .eq("plan_day_id", day.id);
  if (delErr) throw delErr;

  if (day.exercises.length === 0) return;

  const { error: insErr } = await supabase.from("plan_exercises").insert(
    day.exercises.map((e, i) => ({
      plan_day_id: day.id,
      exercise_id: e.exercise_id,
      position: i,
      sets: e.sets,
      rep_low: e.rep_low,
      rep_high: e.rep_high,
      rpe_target: e.rpe_target,
      rest_seconds: e.rest_seconds,
      role: e.role,
      note: e.note,
    })),
  );
  if (insErr) throw insErr;
}

/** The next revision number for a plan. Revision 0 is the plan as generated. */
async function nextRevision(supabase: SupabaseClient, planId: string): Promise<number> {
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("revision")
    .eq("plan_id", planId)
    .order("revision", { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = (data ?? [])[0] as { revision: number } | undefined;
  return latest ? latest.revision + 1 : 1;
}

/**
 * Apply ops to a plan and record the result as a revision.
 *
 * Only days the patch actually touched are rewritten, so editing one exercise
 * does not churn six days of rows.
 *
 * A patch where nothing applied writes no revision. Undo should step back over
 * real changes, not over failed attempts.
 */
export async function applyPatchToPlan(
  supabase: SupabaseClient,
  plan: PlanWithDays,
  ops: PlanOp[],
  source: PlanOpSource,
  library: Exercise[],
): Promise<EditResult> {
  const result = applyPlanPatch(plan, ops, library);
  const summary = summarisePatch(result.applied);

  if (result.applied.length === 0) {
    return { plan: result.plan, applied: [], rejected: result.rejected, revision: null, summary };
  }

  // Self-healing baseline. A plan created before revision tracking existed has
  // no revision 0, so the first edit would leave nothing to undo back to and
  // the Undo button would appear but fail. Write the pre-patch state first.
  await ensureBaselineRevision(supabase, plan);

  const touched = new Set(result.applied.map((o) => o.dayIndex));
  for (const dayIndex of touched) {
    const day = result.plan.days[dayIndex];
    if (!day) continue;
    if (result.applied.some((o) => o.dayIndex === dayIndex && o.op === "rename_day")) {
      const { error } = await supabase
        .from("plan_days")
        .update({ name: day.name, focus: day.focus })
        .eq("id", day.id);
      if (error) throw error;
    }
    // A rename alone does not change the exercise rows, so skip the rewrite.
    if (result.applied.some((o) => o.dayIndex === dayIndex && o.op !== "rename_day")) {
      await rewriteDay(supabase, day);
    }
  }

  const revision = await nextRevision(supabase, plan.id);
  const { error } = await supabase.from("plan_revisions").insert({
    plan_id: plan.id,
    revision,
    source,
    ops: result.applied,
    // The whole plan after the patch. Undo becomes a restore rather than an
    // inverse-operation replay, which is where this kind of feature usually
    // breaks on insert, remove and reorder.
    snapshot: result.plan,
    summary,
  });
  if (error) throw error;

  return { ...result, revision, summary };
}

export interface PlanRevision {
  revision: number;
  source: string;
  summary: string | null;
  created_at: string;
}

/** Revision history for a plan, newest first. */
export async function getRevisions(
  supabase: SupabaseClient,
  planId: string,
): Promise<PlanRevision[]> {
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("revision, source, summary, created_at")
    .eq("plan_id", planId)
    .order("revision", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlanRevision[];
}

/**
 * Step back one revision.
 *
 * Restores the snapshot from the revision BEFORE the latest, then records the
 * undo as its own revision. History moves forward even when the plan moves
 * back, so an undo is never lost and can itself be undone.
 *
 * Returns null when there is nothing to undo.
 */
export async function undoLastRevision(
  supabase: SupabaseClient,
  planId: string,
): Promise<PlanWithDays | null> {
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("revision, snapshot, summary")
    .eq("plan_id", planId)
    .order("revision", { ascending: false })
    .limit(2);
  if (error) throw error;

  const rows = (data ?? []) as { revision: number; snapshot: PlanWithDays; summary: string | null }[];
  // Need a current revision AND something to fall back to.
  if (rows.length < 2) return null;

  const [latest, previous] = rows;
  const restored = previous.snapshot;

  for (const day of restored.days) {
    const { error: dayErr } = await supabase
      .from("plan_days")
      .update({ name: day.name, focus: day.focus })
      .eq("id", day.id);
    if (dayErr) throw dayErr;
    await rewriteDay(supabase, day);
  }

  const { error: insErr } = await supabase.from("plan_revisions").insert({
    plan_id: planId,
    revision: latest.revision + 1,
    source: "athlete_direct",
    ops: [],
    snapshot: restored,
    summary: `Undid: ${latest.summary ?? "the last change"}`.slice(0, 300),
  });
  if (insErr) throw insErr;

  return restored;
}

/**
 * Make sure a plan has a revision 0 to undo back to.
 *
 * Undo restores the snapshot from the revision before the latest, so a plan
 * whose first ever edit is revision 1 has nothing underneath it. That is the
 * state every plan created before revision tracking is in, and it showed up
 * immediately in production: the Undo button appeared after the first chat
 * edit and had nothing to restore.
 *
 * Called with the plan as it was BEFORE the patch, so revision 0 is a true
 * baseline. Idempotent: the unique index on (plan_id, revision) makes a second
 * call a no-op.
 */
export async function ensureBaselineRevision(
  supabase: SupabaseClient,
  plan: PlanWithDays,
): Promise<void> {
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("revision")
    .eq("plan_id", plan.id)
    .limit(1);
  if (error) throw error;
  if ((data ?? []).length > 0) return;

  const { error: insErr } = await supabase.from("plan_revisions").insert({
    plan_id: plan.id,
    revision: 0,
    source: "generated",
    ops: [],
    snapshot: plan,
    summary: "Plan created.",
  });
  // A duplicate means another request won the race. Not an error worth throwing.
  if (insErr && !insErr.message.toLowerCase().includes("duplicate")) throw insErr;
}

/** Load the athlete's active plan, or null. Re-exported so callers need one import. */
export { getActivePlan };
