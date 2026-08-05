// Talk to the coach about the active plan.
//
// Step 6 of docs/PLANNER_V2_DESIGN.md. The athlete says something, the coach
// replies and proposes changes, and the changes are applied through the same
// patch engine a tap uses. Only `source` differs.
//
// Deliberately NOT the generation route. That one builds a whole plan and takes
// about 35 seconds; this returns a couple of ops in a few. Reusing it for "swap
// the deadlift" would be both slow and destructive of everything the athlete
// already accepted.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { PLAN_MODEL, toUsageReport } from "@/lib/ai-model";
import { cloudAvailable } from "@/lib/ai-provider";
import { getExercises, getProfile, getTrainingSets } from "@/lib/data";
import { buildRecords } from "@/lib/analytics/records";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { getAthleteLifts, mergeSelfReported } from "@/lib/athlete-lifts";
import { assessWeakPoints } from "@/lib/analytics/weak-points";
import {
  EQUIPMENT_TAGS,
  filterExercisesForEquipment,
  referenceExercises,
  type EquipmentTag,
} from "@/lib/plan-generation";
import { buildPlanChatPrompt, parseCoachTurn, PLAN_CHAT_TOOL_SCHEMA } from "@/lib/plan-chat";
import { applyPatchToPlan } from "@/lib/plan-edit";
import { getActivePlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// A patch is far smaller than a generation, but the Hobby ceiling is still 60s
// and cannot be raised. See docs/E2E_2026-07-30_planner.md.
export const maxDuration = 60;

const TOOL: Anthropic.Tool = {
  name: "reply_and_edit",
  description:
    "Reply to the athlete and return any changes to their plan, as a small list of operations.",
  input_schema: PLAN_CHAT_TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
};

export async function POST(req: Request) {
  if (!cloudAvailable()) {
    return NextResponse.json({ error: "The coach isn't configured on this server." }, { status: 503 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let message: string;
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: "Say something to your coach." }, { status: 400 });
  if (message.length > 1000) {
    return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  }

  try {
    const plan = await getActivePlan(supabase);
    if (!plan) {
      return NextResponse.json(
        { error: "You do not have an active plan yet. Build one first." },
        { status: 404 },
      );
    }

    const profile = await getProfile(supabase);
    const units = profile?.units ?? "kg";
    const [library, sets] = await Promise.all([
      getExercises(supabase),
      getTrainingSets(supabase, units, 8),
    ]);

    // Same equipment filter the generator uses, so the coach cannot offer a
    // machine the athlete said they do not have. Stored equipment is filtered
    // to currently known tags: plans built before kettlebells were dropped
    // still carry that value, and it is no longer a valid option.
    const equipment = plan.equipment.filter((e): e is EquipmentTag =>
      (EQUIPMENT_TAGS as readonly string[]).includes(e),
    );
    const available = filterExercisesForEquipment(library, equipment);
    const referenced = referenceExercises(available);
    const exerciseIdByRef = new Map(referenced.map((r) => [r.reference, r.exercise.id]));

    // The coach should know what the app knows, so it does not ask the athlete
    // to explain their own weak points again.
    const claims = await getAthleteLifts(supabase, units);
    const weakPoints = assessWeakPoints(
      mergeSelfReported(buildRecords(sets), claims, library),
      buildSetVolume(sets, 4, 8, new Date()),
      {
        bodyweight: profile?.bodyweight ?? null,
        sex: profile?.sex ?? null,
        units,
      },
    );
    const weakPointSummary = weakPoints.insufficientData
      ? []
      : weakPoints.muscles
          .filter((m) => m.status === "lagging" || m.status === "leading")
          .map((m) => `${m.muscle}: ${m.status}. ${m.reasons.join(" ")}`);

    const prompt = buildPlanChatPrompt(plan, referenced, message, weakPointSummary);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const startedAt = Date.now();
    const response = await anthropic.messages.create({
      model: PLAN_MODEL,
      // A reply plus a few ops. Nothing like the 4096 a whole plan needs.
      max_tokens: 1024,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: prompt }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      return NextResponse.json({ error: "The coach did not answer. Try again." }, { status: 502 });
    }

    const { turn, dropped } = parseCoachTurn(toolUse.input, exerciseIdByRef);

    // No ops means the athlete asked a question. Answer without touching the plan.
    if (turn.ops.length === 0) {
      return NextResponse.json({
        reply: turn.reply,
        applied: [],
        rejected: [],
        dropped,
        revision: null,
        usage: toUsageReport(PLAN_MODEL, response.usage),
        ms: Date.now() - startedAt,
      });
    }

    const result = await applyPatchToPlan(supabase, plan, turn.ops, "athlete_chat", library);

    return NextResponse.json({
      reply: turn.reply,
      applied: result.applied.map((o) => ({ op: o.op, dayIndex: o.dayIndex, reason: o.reason })),
      // Surfaced, never swallowed: a request that half worked must not look
      // like one that fully worked.
      rejected: result.rejected.map((r) => ({ reason: r.op.reason, error: r.error })),
      dropped,
      revision: result.revision,
      summary: result.summary,
      usage: toUsageReport(PLAN_MODEL, response.usage),
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("Plan chat error:", error);
    return NextResponse.json({ error: "The coach could not do that. Try again." }, { status: 502 });
  }
}
