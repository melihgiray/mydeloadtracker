import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { PLAN_MODEL, toUsageReport, type UsageReport } from "@/lib/ai-model";
import {
  LOCAL_MODELS,
  LOCAL_TIMEOUT_MS,
  cloudAvailable,
  localOptions,
  preferredProvider,
  type Provider,
} from "@/lib/ai-provider";
import { getCheckins, getExercises, getProfile, getTrainingSets } from "@/lib/data";
import { detectDeload } from "@/lib/analytics/deload";
import { buildRecords } from "@/lib/analytics/records";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { classifyLift } from "@/lib/analytics/standards";
import {
  EVIDENCE_CAVEAT,
  MUSCLE_GROUPS,
  canValidate,
  prescriptionRange,
} from "@/lib/analytics/volume-landmarks";
import { ollamaChat } from "@/lib/ollama";
import {
  PLAN_TOOL_INPUT_SCHEMA,
  buildPlannerPrompt,
  buildPlannerRetryPrompt,
  filterExercisesForEquipment,
  parseGeneratedPlan,
  parsePlanIntake,
  referenceExercises,
  recentSessionFrequency,
  resolveExerciseReferences,
  toNewPlan,
  type GeneratedPlan,
  type PlannerSnapshot,
} from "@/lib/plan-generation";
import {
  validateGeneratedPlan,
  type PlanValidationIssue,
} from "@/lib/plan-validation";
import { createPlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PLAN_TOOL: Anthropic.Tool = {
  name: "save_training_plan",
  description:
    "Return the complete structured training plan. Copy only compact exercise references supplied in the athlete data.",
  input_schema: PLAN_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool["input_schema"],
};

const MAX_GENERATED_CANDIDATES = 2;

/**
 * Wall-clock budget for the whole route, from maxDuration above.
 *
 * The Vercel account is on Hobby, where 60s is a hard per-function ceiling that
 * cannot be raised. A second generation attempt is only worth starting if there
 * is plausibly time to finish it AND still write three tables afterwards.
 * Measured in production: a first attempt that has already burned past this
 * mark will not fit a second, and the athlete gets a 504 instead of a plan.
 */
const ROUTE_BUDGET_MS = 60_000;
const RETRY_CUTOFF_MS = 24_000;
/** Room for the plan, day and exercise inserts after generation returns. */
const PERSIST_RESERVE_MS = 6_000;

class CandidateRejectedError extends Error {
  constructor(
    message: string,
    readonly issues: PlanValidationIssue[] = [],
  ) {
    super(message);
    this.name = "CandidateRejectedError";
  }
}

function parseAndValidateCandidate(
  value: unknown,
  exerciseIdByReference: ReadonlyMap<string, string>,
  intake: ReturnType<typeof parsePlanIntake>,
  library: Awaited<ReturnType<typeof getExercises>>,
): { plan: GeneratedPlan; warnings: PlanValidationIssue[] } {
  let plan: GeneratedPlan;
  try {
    const referencedPlan = parseGeneratedPlan(
      value,
      new Set(exerciseIdByReference.keys()),
      intake,
    );
    plan = resolveExerciseReferences(referencedPlan, exerciseIdByReference);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The generated plan was malformed.";
    throw new CandidateRejectedError(message);
  }

  const validation = validateGeneratedPlan(plan, intake, library);
  if (!validation.valid) {
    throw new CandidateRejectedError(
      validation.errors.map((issue) => issue.message).join(" "),
      validation.errors,
    );
  }
  return { plan, warnings: validation.warnings };
}

function addUsage(total: UsageReport | null, next: UsageReport): UsageReport {
  if (!total) return next;
  return {
    model: next.model,
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + next.cacheWriteTokens,
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  if (!cloudAvailable() && preferredProvider("plan") !== "local") {
    return jsonError("Plan generation is not configured on this server.", 503);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Not authenticated.", 401);

  let intake;
  try {
    intake = parsePlanIntake(await req.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid plan intake.";
    return jsonError(message, 400);
  }

  try {
    const profile = await getProfile(supabase);
    const units = profile?.units ?? "kg";
    const [sets, checkins, library] = await Promise.all([
      getTrainingSets(supabase, units, 8),
      getCheckins(supabase, 30),
      getExercises(supabase),
    ]);
    const exercises = filterExercisesForEquipment(library, intake.equipment);
    if (exercises.length === 0) {
      return jsonError("No exercises match the selected equipment.", 400);
    }
    const referencedExercises = referenceExercises(exercises);

    const now = new Date();
    const setVolume = buildSetVolume(sets, 4, 8, now);
    const readiness = computeReadiness(sets, checkins, now, {
      bodyweight: profile?.bodyweight ?? null,
      sex: profile?.sex ?? null,
      units,
    });
    const deload = detectDeload(sets, now);
    const records = buildRecords(sets);
    const strengthLevels =
      profile?.bodyweight && profile.sex
        ? records
            .filter((record) => record.isMajor)
            .map((record) =>
              classifyLift(
                record.exerciseName,
                { e1rm: record.bestE1RM, reps: record.bestReps },
                profile.bodyweight!,
                profile.sex!,
                units,
              ),
            )
            .filter((level) => level != null)
            .map((level) => ({
              lift: level.lift,
              level: level.level.label,
              metric: level.metric,
            }))
        : [];

    const volumeByMuscle = new Map(
      setVolume.muscles.map((muscle) => [muscle.muscleGroup, muscle]),
    );
    const snapshot: PlannerSnapshot = {
      loggedSets: sets.length,
      sessionsPerWeek: recentSessionFrequency(sets, now),
      currentSetsPerMuscle: MUSCLE_GROUPS.map((muscle) => ({
        muscle,
        setsPerWeek: volumeByMuscle.get(muscle)?.setsPerWeek ?? 0,
        thisWeek: volumeByMuscle.get(muscle)?.thisWeek ?? 0,
      })),
      strengthLevels,
      readiness: {
        score: readiness.score,
        band: readiness.band.label,
        topDrivers: readiness.topDrivers,
      },
      deload: { recommended: deload.recommended, reasons: deload.reasons },
      landmarks: MUSCLE_GROUPS.map((muscle) => {
        const safe = canValidate(muscle);
        const range = safe ? prescriptionRange(muscle) : null;
        return {
          muscle,
          canValidate: safe,
          target: range ? { min: range.min, max: range.max } : null,
        };
      }),
      evidenceCaveat: EVIDENCE_CAVEAT,
      exercises: referencedExercises.map(({ reference, exercise }) => ({
        id: reference,
        name: exercise.name,
        muscleGroup: exercise.muscle_group,
        equipment: exercise.equipment!,
        isMajor: exercise.is_major,
      })),
    };

    const prompt = buildPlannerPrompt(intake, snapshot);
    const exerciseIdByReference = new Map(
      referencedExercises.map(({ reference, exercise }) => [reference, exercise.id]),
    );
    let generated: GeneratedPlan | null = null;
    let provider: Provider = preferredProvider("plan");
    let validationWarnings: PlanValidationIssue[] = [];
    let usage:
      | ReturnType<typeof toUsageReport>
      | { model: string; provider: "local" }
      | null = null;
    let cloudUsage: UsageReport | null = null;
    let candidateCount = 0;
    let retryProblem: string | null = null;
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    while (!generated && candidateCount < MAX_GENERATED_CANDIDATES) {
      // Skip a retry there is no time for. Timing out returns nothing at all,
      // which is strictly worse than reporting why the first attempt failed.
      if (candidateCount > 0 && elapsed() > RETRY_CUTOFF_MS) {
        console.warn(
          `Skipping plan retry: ${elapsed()}ms elapsed of a ${ROUTE_BUDGET_MS}ms budget.`,
        );
        break;
      }
      const attemptPrompt = retryProblem
        ? buildPlannerRetryPrompt(prompt, retryProblem)
        : prompt;
      let candidateInput: unknown;

      if (provider === "local") {
        try {
          const response = await ollamaChat(
            {
              model: LOCAL_MODELS.plan,
              stream: false,
              think: false,
              format: PLAN_TOOL_INPUT_SCHEMA,
              ...localOptions(4096),
              messages: [
                {
                  role: "system",
                  content:
                    "You are a strength program planner. Return only the JSON object required by the supplied schema.",
                },
                { role: "user", content: attemptPrompt },
              ],
            },
            LOCAL_TIMEOUT_MS.plan,
          );
          const body = (await response.json()) as { message?: { content?: string } };
          if (!body.message?.content) {
            throw new CandidateRejectedError(
              "The local coach did not return a structured training plan.",
            );
          }
          try {
            candidateInput = JSON.parse(body.message.content);
          } catch {
            throw new CandidateRejectedError("The local coach returned malformed JSON.");
          }
        } catch (error) {
          if (error instanceof CandidateRejectedError) {
            candidateCount += 1;
            retryProblem = error.message;
            console.warn("Local plan candidate rejected:", error.message);
            if (cloudAvailable()) provider = "cloud";
            continue;
          }
          console.warn("Local plan generation unavailable, falling back to the cloud:", error);
          if (!cloudAvailable()) {
            return jsonError("Plan generation is not reachable right now.", 503);
          }
          provider = "cloud";
          retryProblem = null;
          continue;
        }
      } else {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const callStartedAt = Date.now();
        const response = await anthropic.messages.create({
          model: PLAN_MODEL,
          // A seven day plan of twelve exercises each is well under 3000 output
          // tokens. 4096 was headroom that only ever bought a slower worst case
          // against a ceiling that cannot move.
          max_tokens: 3000,
          tools: [PLAN_TOOL],
          tool_choice: { type: "tool", name: PLAN_TOOL.name },
          messages: [{ role: "user", content: attemptPrompt }],
        });
        // Logged because the budget arithmetic above is only as good as this
        // number, and it was previously unmeasured in production.
        console.info(
          `Plan generation attempt ${candidateCount + 1}: ${Date.now() - callStartedAt}ms, ` +
            `${response.usage?.output_tokens ?? 0} output tokens, model ${PLAN_MODEL}.`,
        );
        cloudUsage = addUsage(cloudUsage, toUsageReport(PLAN_MODEL, response.usage));
        const toolUse = response.content.find(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );
        if (!toolUse) {
          candidateCount += 1;
          retryProblem = "The coach did not return a structured training plan.";
          continue;
        }
        candidateInput = toolUse.input;
      }

      candidateCount += 1;
      try {
        const candidate = parseAndValidateCandidate(
          candidateInput,
          exerciseIdByReference,
          intake,
          library,
        );
        generated = candidate.plan;
        validationWarnings = candidate.warnings;
        usage =
          provider === "local"
            ? { model: LOCAL_MODELS.plan, provider: "local" }
            : cloudUsage;
      } catch (error) {
        if (!(error instanceof CandidateRejectedError)) throw error;
        retryProblem = error.message;
        console.warn(`${provider} plan candidate rejected:`, error.message);
        if (provider === "local" && cloudAvailable()) provider = "cloud";
      }
    }

    if (!generated) {
      return jsonError(
        `The coach could not build a valid plan: ${retryProblem ?? "the generated plan was incomplete."}`,
        502,
      );
    }

    const planId = await createPlan(supabase, toNewPlan(intake, generated));
    return NextResponse.json({ planId, provider, usage, warnings: validationWarnings });
  } catch (error) {
    console.error("Plan generation error:", error);
    return jsonError("The coach could not build a valid plan. Try again.", 502);
  }
}
