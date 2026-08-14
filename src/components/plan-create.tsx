"use client";

import { useState } from "react";
import type { Units } from "@/lib/types";
import { PlanIntakeChat } from "@/components/plan-intake-chat";
import { PlanBuilder } from "@/components/plan-builder";
import type { PickerExercise } from "@/components/plan-exercise-picker";

// Creation surface for an athlete with no plan yet. Conversational by default
// (the founder's ask), with the original form one tap away for anyone who
// prefers it. Once a plan exists the page shows PlanBuilder + PlanCoachChat.
export function PlanCreate({
  units,
  library,
  evidenceCaveat,
  onCancel,
}: {
  units: Units;
  library: PickerExercise[];
  evidenceCaveat: string;
  /** Present when rebuilding over an existing plan: lets the athlete back out. */
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<"chat" | "form">("chat");

  if (mode === "chat") {
    return <PlanIntakeChat units={units} onManual={() => setMode("form")} onCancel={onCancel} />;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMode("chat")}
          className="text-xs text-muted hover:text-foreground"
        >
          ← Back to talking with the coach
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-muted hover:text-foreground"
          >
            Keep current plan
          </button>
        )}
      </div>
      <PlanBuilder initialPlan={null} evidenceCaveat={evidenceCaveat} library={library} />
    </div>
  );
}
