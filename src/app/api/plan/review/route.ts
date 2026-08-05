// The weekly review: propose next week's adjustments, never apply them.
//
// Step 7 of docs/PLANNER_V2_DESIGN.md. The design's hardest rule is here in one
// line: this route CHANGES NOTHING. It returns a proposal and the athlete taps
// to accept it through /api/plan/edit. A plan that rewrites itself under
// somebody between Sunday and Monday is worse than one that never changes.
//
// It also does not stamp last_reviewed_on. Only accepting or dismissing does,
// which is /api/plan/edit's job. Otherwise merely opening the app would burn
// the review for the week.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { PLAN_MODEL, toUsageReport } from "@/lib/ai-model";
import { cloudAvailable } from "@/lib/ai-provider";
import { getExercises, getProfile, getTrainingSets } from "@/lib/data";
import { buildRecords } from "@/lib/analytics/records";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { localDateKey } from "@/lib/analytics/dates";
import { getAthleteLifts, mergeSelfReported } from "@/lib/athlete-lifts";
import { assessWeakPoints } from "@/lib/analytics/weak-points";
import {
  EQUIPMENT_TAGS,
  filterExercisesForEquipment,
  referenceExercises,
  type EquipmentTag,
} from "@/lib/plan-generation";
import { parseCoachTurn, PLAN_CHAT_TOOL_SCHEMA } from "@/lib/plan-chat";
import {
  buildPlanReview,
  buildWeeklyReviewPrompt,
  isBigChange,
  withoutDayEmptyingOps,
} from "@/lib/plan-review";
import { getActivePlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const TOOL: Anthropic.Tool = {
  name: "review_the_week",
  description:
    "Tell the athlete how their week went and return any adjustments to next week's plan.",
  input_schema: PLAN_CHAT_TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
};

export async function POST() {
  if (!cloudAvailable()) {
    return NextResponse.json({ error: "The coach isn't configured on this server." }, { status: 503 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const plan = await getActivePlan(supabase);
    if (!plan) {
      return NextResponse.json({ error: "You do not have an active plan yet." }, { status: 404 });
    }

    const profile = await getProfile(supabase);
    const units = profile?.units ?? "kg";
    const [library, sets] = await Promise.all([
      getExercises(supabase),
      // Three weeks covers the two the review compares plus a margin for
      // sessions dated slightly off. Anything older is not evidence about
      // this week.
      getTrainingSets(supabase, units, 3),
    ]);

    const review = buildPlanReview(plan, sets, localDateKey(new Date()));

    const equipment = plan.equipment.filter((e): e is EquipmentTag =>
      (EQUIPMENT_TAGS as readonly string[]).includes(e),
    );
    const referenced = referenceExercises(filterExercisesForEquipment(library, equipment));
    const exerciseIdByRef = new Map(referenced.map((r) => [r.reference, r.exercise.id]));

    const claims = await getAthleteLifts(supabase, units);
    const weakPoints = assessWeakPoints(
      mergeSelfReported(buildRecords(sets), claims, library),
      buildSetVolume(sets, 4, 8, new Date()),
      { bodyweight: profile?.bodyweight ?? null, sex: profile?.sex ?? null, units },
    );
    const weakPointSummary = weakPoints.insufficientData
      ? []
      : weakPoints.muscles
          .filter((m) => m.status === "lagging" || m.status === "leading")
          .map((m) => `${m.muscle}: ${m.status}. ${m.reasons.join(" ")}`);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const startedAt = Date.now();
    const response = await anthropic.messages.create({
      model: PLAN_MODEL,
      max_tokens: 1024,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: buildWeeklyReviewPrompt(plan, review, referenced, weakPointSummary),
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      return NextResponse.json({ error: "The review did not come back. Try again." }, { status: 502 });
    }

    const { turn, dropped } = parseCoachTurn(toolUse.input, exerciseIdByRef);
    const guarded = withoutDayEmptyingOps(plan, turn.ops);

    return NextResponse.json({
      reply: turn.reply,
      ops: guarded.ops,
      dropped: [...dropped, ...guarded.dropped],
      // The design's continuity rule, surfaced rather than enforced: a big
      // change is still the athlete's to accept, they just get told first.
      bigChange: isBigChange(plan, guarded.ops),
      week: {
        from: review.from,
        to: review.to,
        sessionsLogged: review.sessionsLogged,
        sessionsPlanned: review.sessionsPlanned,
        progressed: review.lifts.filter((l) => l.trend === "progressed").map((l) => l.name),
        stalled: review.stalled.map((l) => l.name),
        untrained: review.untrained.map((l) => l.name),
      },
      usage: toUsageReport(PLAN_MODEL, response.usage),
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("Plan review error:", error);
    return NextResponse.json({ error: "The review could not run. Try again." }, { status: 502 });
  }
}
