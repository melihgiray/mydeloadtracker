"use client";

import { useEffect, useState } from "react";
import type { PlanWithDays, Units } from "@/lib/types";
import type { PickerExercise } from "@/components/plan-exercise-picker";
import { PlanBuilder } from "@/components/plan-builder";
import { PlanCoachChat } from "@/components/plan-coach-chat";
import { PlanCreate } from "@/components/plan-create";

// Owns whether the athlete is viewing their plan or (re)building one. Building
// is conversational for everyone now: a new athlete starts here, and "Replace
// plan" on an existing plan hands off to the same coach chat instead of the old
// form.
export function PlanWorkspace({
  plan,
  units,
  library,
  evidenceCaveat,
}: {
  plan: PlanWithDays | null;
  units: Units;
  library: PickerExercise[];
  evidenceCaveat: string;
}) {
  const [replacing, setReplacing] = useState(plan == null);

  // A successful build refreshes the page, which sends a fresh plan object.
  // Drop back to the plan view when that happens (also covers the first build).
  useEffect(() => {
    if (plan) setReplacing(false);
  }, [plan]);

  if (replacing) {
    return (
      <PlanCreate
        units={units}
        library={library}
        evidenceCaveat={evidenceCaveat}
        onCancel={plan ? () => setReplacing(false) : undefined}
      />
    );
  }

  return (
    <>
      <PlanCoachChat hasPlan={true} />
      <PlanBuilder
        initialPlan={plan}
        evidenceCaveat={evidenceCaveat}
        library={library}
        onReplace={() => setReplacing(true)}
      />
    </>
  );
}
