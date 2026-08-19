"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Dumbbell, Loader2, Send, Sparkles } from "lucide-react";
import type { PlanIntake } from "@/lib/plan-generation";
import type { Units } from "@/lib/types";
import { completeIntake, missingEssentials, type ResolvedLift } from "@/lib/plan-intake";
import { toKg } from "@/lib/units";
import { usePersistentState } from "@/lib/use-persistent-state";

// Conversational plan creation: the athlete describes their training and the
// coach gathers goal, days per week, and equipment over a short chat, then
// builds the plan through the same /api/plan generator the form uses. This is
// the founder's ask, that planning should feel like talking to a coach.

interface Turn {
  role: "athlete" | "coach";
  text: string;
}

const GREETING =
  "Let's build your plan together. Tell me your goal, how many days a week you can train, and what equipment you have. Describe it however feels natural.";

const INITIAL_TURNS: Turn[] = [{ role: "coach", text: GREETING }];

const SUGGESTIONS = [
  "Build muscle, 4 days a week, full gym",
  "Get stronger, 3 days, just a barbell and rack",
  "Both, 5 days, dumbbells and machines, bad shoulder",
];

const GOAL_LABEL: Record<PlanIntake["goal"], string> = {
  hypertrophy: "Build muscle",
  strength: "Get stronger",
  both: "Both",
};

export function PlanIntakeChat({
  units,
  onManual,
  onCancel,
}: {
  /** The athlete's display unit, so captured lifts save as canonical kilograms. */
  units: Units;
  onManual: () => void;
  /** When rebuilding over an existing plan, lets the athlete back out. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  // Persisted so leaving the tab mid-conversation does not throw the whole
  // interview away. Restored on return, cleared once a plan is actually built.
  const [turns, setTurns, clearTurns] = usePersistentState<Turn[]>("plan-intake.turns", INITIAL_TURNS);
  const [draft, setDraft, clearDraft] = usePersistentState("plan-intake.draft", "");
  const [intake, setIntake, clearIntake] = usePersistentState<Partial<PlanIntake>>("plan-intake.intake", {});
  // Lifts accumulate across turns by exercise, latest set winning, so a turn
  // where the model forgets to re-list one does not lose it.
  const [lifts, setLifts, clearLifts] = usePersistentState<ResolvedLift[]>("plan-intake.lifts", []);
  const [modelReady, setModelReady, clearModelReady] = usePersistentState("plan-intake.ready", false);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearConversation() {
    clearTurns();
    clearDraft();
    clearIntake();
    clearLifts();
    clearModelReady();
  }

  // Ready needs both the hard essentials AND the coach's own read that it has
  // interviewed enough. That second gate is what stops the chat collapsing back
  // into a form that offers Build the instant it hears goal, days, equipment.
  const ready = modelReady && missingEssentials(intake).length === 0;

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy || building) return;
    setError(null);
    setDraft("");
    const nextTurns: Turn[] = [...turns, { role: "athlete", text }];
    setTurns(nextTurns);
    setBusy(true);
    try {
      // The opening coach greeting is UI-only; the model conversation must start
      // with a user message, so drop any leading coach turns.
      const apiMessages = nextTurns
        .map((t) => ({ role: t.role === "athlete" ? ("user" as const) : ("assistant" as const), content: t.text }))
        .filter((_, i, arr) => arr.slice(0, i + 1).some((m) => m.role === "user"));
      const res = await fetch("/api/plan/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reply?: string;
        intake?: Partial<PlanIntake>;
        lifts?: ResolvedLift[];
        modelReady?: boolean;
      };
      if (!res.ok) throw new Error(body.error ?? "The coach could not answer. Try again.");
      // The model re-extracts everything said so far each turn, so a merge that
      // lets the latest turn win is correct.
      if (body.intake) setIntake((prev) => ({ ...prev, ...body.intake }));
      if (body.lifts && body.lifts.length > 0) {
        setLifts((prev) => {
          const byId = new Map(prev.map((l) => [l.exerciseId, l]));
          for (const l of body.lifts!) byId.set(l.exerciseId, l);
          return [...byId.values()];
        });
      }
      setModelReady(body.modelReady === true);
      setTurns((t) => [...t, { role: "coach", text: body.reply || "Got it." }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    const full = completeIntake(intake);
    if (!full || building) return;
    setBuilding(true);
    setError(null);
    try {
      // Save what the athlete told us they can lift BEFORE generating, so the
      // plan and the per-muscle assessment are built with those numbers. Stored
      // canonical in kilograms, converted from the athlete's display unit here.
      // A save failure degrades to a plan without the claims rather than
      // blocking the athlete, so it is caught and does not stop the build.
      if (lifts.length > 0) {
        try {
          await fetch("/api/athlete-lifts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lifts: lifts.map((l) => ({
                exerciseId: l.exerciseId,
                weight: toKg(l.weight, units),
                reps: l.reps,
              })),
            }),
          });
        } catch {
          /* build with what we have */
        }
      }
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The coach could not build your plan.");
      // The plan exists now, so the saved conversation has served its purpose.
      // Clear it so a later "Replace plan" starts fresh instead of reopening
      // this finished interview.
      clearConversation();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not build your plan.");
      setBuilding(false);
    }
  }

  const chips = [
    { label: "Goal", value: intake.goal ? GOAL_LABEL[intake.goal] : null },
    { label: "Days", value: intake.daysPerWeek != null ? `${intake.daysPerWeek}/wk` : null },
    { label: "Equipment", value: intake.equipment?.length ? intake.equipment.join(", ") : null },
  ];
  const muscleGroupsCovered = new Set(lifts.map((l) => l.muscleGroup)).size;

  return (
    <section className="panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand">
            <Sparkles className="h-4 w-4" />
          </span>
          <h2 className="font-semibold">Build your plan with the coach</h2>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onManual} className="text-xs text-muted hover:text-foreground">
            Prefer a form?
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
      </div>

      {/* What the coach has understood so far, filling in as you talk. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span
            key={c.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              c.value ? "bg-brand/15 text-brand" : "bg-background text-muted"
            }`}
          >
            {c.value && <Check className="h-3 w-3" />}
            <span className="font-medium">{c.label}:</span> {c.value ?? "?"}
          </span>
        ))}
      </div>

      {/* The lifts the coach has gathered, which become the per-muscle picture
          the plan and the weak-point assessment read. Shown as it fills in so
          the athlete can see the interview is actually learning about them. */}
      {lifts.length > 0 && (
        <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Dumbbell className="h-3.5 w-3.5" />
            What you can lift, {muscleGroupsCovered} {muscleGroupsCovered === 1 ? "muscle group" : "muscle groups"} so far
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lifts.map((l) => (
              <span
                key={l.exerciseId}
                className="rounded-full bg-surface px-2.5 py-1 text-xs text-foreground"
                title={l.muscleGroup}
              >
                <span className="font-medium">{l.name}</span>{" "}
                <span className="readout text-muted">
                  {l.weight} {units} × {l.reps}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "athlete" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                t.role === "athlete"
                  ? "bg-brand text-brand-foreground"
                  : "border border-border bg-background"
              }`}
            >
              {t.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-background px-3.5 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
            </div>
          </div>
        )}
      </div>

      {turns.length === 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="tap rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {ready ? (
        <button
          type="button"
          onClick={build}
          disabled={building}
          className="btn-brand mt-4 w-full"
        >
          {building ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Building your plan, about half a minute
            </>
          ) : (
            <>Build my plan</>
          )}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="mt-4 flex items-end gap-2"
        >
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Tell the coach about your training..."
            className="input max-h-32 flex-1 resize-none"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="btn-brand h-10 w-10 flex-shrink-0 rounded-xl p-0"
            aria-label="Send"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      )}
    </section>
  );
}
