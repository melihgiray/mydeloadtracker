// Step back one revision on the active plan.
//
// Part of step 2 in docs/PLANNER_V2_DESIGN.md. Restores the previous snapshot
// and drops the reverted revision, so every press walks backward rather than
// toggling between the latest two states.

import { NextResponse } from "next/server";
import { getActivePlan } from "@/lib/plans";
import { undoLastRevision } from "@/lib/plan-edit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const plan = await getActivePlan(supabase);
    if (!plan) return NextResponse.json({ error: "No active plan." }, { status: 404 });

    const restored = await undoLastRevision(supabase, plan.id);
    if (!restored) {
      // Either the plan has never been edited, or it predates revision
      // tracking. Both are "nothing to step back to" from the athlete's side.
      return NextResponse.json({ error: "There is nothing to undo." }, { status: 400 });
    }

    return NextResponse.json({ summary: "Reverted the last change to your plan." });
  } catch (error) {
    console.error("Plan undo error:", error);
    return NextResponse.json({ error: "Could not undo that. Try again." }, { status: 502 });
  }
}
