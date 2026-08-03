import { EVIDENCE_CAVEAT } from "@/lib/analytics/volume-landmarks";
import { PlanBuilder } from "@/components/plan-builder";
import { PlanCoachChat } from "@/components/plan-coach-chat";
import { getActivePlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = createClient();
  const plan = await getActivePlan(supabase);

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
      <PlanCoachChat hasPlan={plan != null} />
      <PlanBuilder initialPlan={plan} evidenceCaveat={EVIDENCE_CAVEAT} />
    </div>
  );
}
