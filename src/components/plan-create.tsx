"use client";

import { useState } from "react";
import { PlanIntakeChat } from "@/components/plan-intake-chat";
import { PlanBuilder } from "@/components/plan-builder";
import type { PickerExercise } from "@/components/plan-exercise-picker";

// Creation surface for an athlete with no plan yet. Conversational by default
// (the founder's ask), with the original form one tap away for anyone who
// prefers it. Once a plan exists the page shows PlanBuilder + PlanCoachChat.
export function PlanCreate({
  library,
  evidenceCaveat,
}: {
  library: PickerExercise[];
  evidenceCaveat: string;
}) {
  const [mode, setMode] = useState<"chat" | "form">("chat");

  if (mode === "chat") {
    return <PlanIntakeChat onManual={() => setMode("form")} />;
  }
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setMode("chat")}
        className="text-xs text-muted hover:text-foreground"
      >
        ← Back to talking with the coach
      </button>
      <PlanBuilder initialPlan={null} evidenceCaveat={evidenceCaveat} library={library} />
    </div>
  );
}
