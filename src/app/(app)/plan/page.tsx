import { EVIDENCE_CAVEAT } from "@/lib/analytics/volume-landmarks";
import { PlanBuilder } from "@/components/plan-builder";
import { PlanCreate } from "@/components/plan-create";
import { PlanCoachChat } from "@/components/plan-coach-chat";
import { WeeklyReview } from "@/components/weekly-review";
import { isReviewDue } from "@/lib/plan-review";
import { getActivePlan } from "@/lib/plans";
import { coldStartIntakeQuestions, getAthleteLifts } from "@/lib/athlete-lifts";
import { getExercises, getProfile, getTrainingSets } from "@/lib/data";
import { buildRecords } from "@/lib/analytics/records";
import { LiftIntake } from "@/components/lift-intake";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = createClient();
  const plan = await getActivePlan(supabase);

  // Only ask about lifts the athlete has not already logged. The rule from v1
  // still holds: never ask for something the app can work out.
  const profilePromise = getProfile(supabase);
  const [library, profile, sets, claims] = await Promise.all([
    getExercises(supabase),
    profilePromise,
    // Five years, not the usual eight weeks. This window decides whether the
    // app already KNOWS a lift, and a bench logged three months ago is still
    // known. The eight-week window is for "what are they training now", which
    // is a different question.
    getTrainingSets(supabase, "kg", 260),
    profilePromise.then((value) => getAthleteLifts(supabase, value?.units ?? "kg")),
  ]);
  const units = profile?.units ?? "kg";
  const loggedIds = new Set(buildRecords(sets).map((r) => r.exerciseId));
  const questions = coldStartIntakeQuestions(library, claims, loggedIds).map((q) => ({
    exerciseId: q.exercise.id,
    name: q.exercise.name,
    covers: q.covers,
    weight: q.answer ? String(q.answer.weight) : "",
    reps: q.answer ? String(q.answer.reps) : "",
  }));

  // Only what a swap picker needs, and only what the athlete can actually do.
  // Sending the whole library would offer equipment they said they do not have.
  const planEquipment = new Set(plan?.equipment ?? []);
  const pickerLibrary = library
    .filter((e) => !e.hidden)
    .filter((e) => planEquipment.size === 0 || (e.equipment != null && planEquipment.has(e.equipment)))
    .map((e) => ({ id: e.id, name: e.name, muscle_group: e.muscle_group }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Training plan</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Your coach uses your logged training, strength level, and readiness. You only fill in
          what the app cannot know.
        </p>
      </div>
      {/* Above the plan on purpose. The founder's first complaint was that a
          plan could only be replaced, never talked about, so the way to change
          it should be the first thing visible once one exists. */}
      {/* Above the plan, and above the chat, because a plan built without
          knowing anything about the athlete is the thing being fixed. Disappears
          once every lift is either answered or logged. */}
      <LiftIntake questions={questions} units={units} />

      {/* Above the chat: a week that is ready to review is the most useful
          thing on the screen, and it disappears the moment it is answered. */}
      {plan && <WeeklyReview due={isReviewDue(plan)} />}

      {plan ? (
        <>
          <PlanCoachChat hasPlan={true} />
          <PlanBuilder initialPlan={plan} evidenceCaveat={EVIDENCE_CAVEAT} library={pickerLibrary} />
        </>
      ) : (
        // No plan yet: build it by talking to the coach (form available behind a tap).
        <PlanCreate evidenceCaveat={EVIDENCE_CAVEAT} library={pickerLibrary} />
      )}
    </div>
  );
}
