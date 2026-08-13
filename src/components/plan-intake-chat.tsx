"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send, Sparkles } from "lucide-react";
import type { PlanIntake } from "@/lib/plan-generation";
import { completeIntake, missingEssentials } from "@/lib/plan-intake";

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
  onManual,
  onCancel,
}: {
  onManual: () => void;
  /** When rebuilding over an existing plan, lets the athlete back out. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([{ role: "coach", text: GREETING }]);
  const [draft, setDraft] = useState("");
  const [intake, setIntake] = useState<Partial<PlanIntake>>({});
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = missingEssentials(intake).length === 0;

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
      };
      if (!res.ok) throw new Error(body.error ?? "The coach could not answer. Try again.");
      // The model re-extracts everything said so far each turn, so a merge that
      // lets the latest turn win is correct.
      if (body.intake) setIntake((prev) => ({ ...prev, ...body.intake }));
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
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The coach could not build your plan.");
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
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
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
