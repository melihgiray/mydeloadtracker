// Save what the athlete says they can lift.
//
// Step 3 of docs/PLANNER_V2_DESIGN.md. Weight and reps, not a 1RM, because
// nobody knows their true 1RM and asking for one invites invention.

import { NextResponse } from "next/server";
import { saveAthleteLifts, type LiftClaim } from "@/lib/athlete-lifts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let claims: LiftClaim[];
  try {
    const body = (await req.json()) as { lifts?: unknown };
    const raw = Array.isArray(body.lifts) ? body.lifts : [];
    claims = raw.flatMap((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      const exerciseId = typeof c.exerciseId === "string" ? c.exerciseId : null;
      const weight = Number(c.weight);
      const reps = Number(c.reps);
      // A skipped question arrives as blank and is simply absent. Never write a
      // zero: that reads as "I can lift nothing" rather than "I would rather
      // not say".
      if (!exerciseId || !Number.isFinite(weight) || weight < 0) return [];
      if (!Number.isInteger(reps) || reps < 1 || reps > 100) return [];
      return [{ exerciseId, weight, reps }];
    });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (claims.length > 20) {
    return NextResponse.json({ error: "Too many lifts at once." }, { status: 400 });
  }

  try {
    await saveAthleteLifts(supabase, claims);
    return NextResponse.json({ saved: claims.length });
  } catch (error) {
    console.error("Athlete lifts save error:", error);
    return NextResponse.json({ error: "Could not save those. Try again." }, { status: 502 });
  }
}
