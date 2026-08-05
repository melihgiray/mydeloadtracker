// Save what the athlete says they can lift.
//
// Step 3 of docs/PLANNER_V2_DESIGN.md. Weight and reps, not a 1RM, because
// nobody knows their true 1RM and asking for one invites invention.

import { NextResponse } from "next/server";
import { parseLiftClaims, saveAthleteLifts, type LiftClaim } from "@/lib/athlete-lifts";
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
    const parsed = parseLiftClaims(body.lifts);
    if (!parsed) {
      return NextResponse.json(
        { error: "Check that every lift has a positive weight and 1 to 100 reps." },
        { status: 400 },
      );
    }
    claims = parsed;
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
