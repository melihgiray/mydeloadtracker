"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, Check, Loader2 } from "lucide-react";
import type { PlanOp } from "@/lib/plan-patch";

/**
 * The weekly check-in with the coach.
 *
 * Step 7 of docs/PLANNER_V2_DESIGN.md. Three deliberate properties:
 *
 * - Nothing runs until the athlete taps. Opening the app does not spend a model
 *   call, and more importantly it does not change a plan under somebody.
 * - The proposal is shown as a list of specific changes with reasons, not as a
 *   paragraph that claims changes were made. They accept or they do not.
 * - A big change is labelled as one before they accept it, because continuity
 *   is the whole point of reviewing instead of regenerating.
 */

interface ReviewWeek {
  from: string;
  to: string;
  sessionsLogged: number;
  sessionsPlanned: number;
  progressed: string[];
  stalled: string[];
  untrained: string[];
}

interface Proposal {
  reply: string;
  ops: PlanOp[];
  dropped: string[];
  bigChange: boolean;
  week: ReviewWeek;
}

type Phase = "idle" | "running" | "proposed" | "applying" | "done";

export function WeeklyReview({ due }: { due: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  if (!due || hidden) return null;

  async function run() {
    setPhase("running");
    setError(null);
    try {
      const res = await fetch("/api/plan/review", { method: "POST" });
      const body = (await res.json()) as Proposal & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The review could not run.");
      setProposal(body);
      setPhase("proposed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not run.");
      setPhase("idle");
    }
  }

  async function send(payload: Record<string, unknown>) {
    setPhase("applying");
    setError(null);
    try {
      const res = await fetch("/api/plan/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { error?: string; summary?: string };
      if (!res.ok) throw new Error(body.error ?? "Those changes could not be saved.");
      setSummary(body.summary ?? null);
      setPhase("done");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those changes could not be saved.");
      setPhase("proposed");
    }
  }

  if (phase === "done") {
    return (
      <div className="card border-brand/40">
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Plan updated for this week.</p>
            {summary && <p className="mt-1 text-xs leading-relaxed text-muted">{summary}</p>}
            <p className="mt-1 text-xs text-muted">
              You can undo this from the coach above if it is not what you wanted.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-brand/40">
      <div className="flex items-start gap-2">
        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Your week is ready to review</h2>
          {/* Only until the proposal lands. After that the reply says it
              better, and two explanations of the same card is noise. */}
          {!proposal && (
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Your coach looks at what you actually did against what the plan asked for, then
              suggests changes. Nothing changes until you accept.
            </p>
          )}
        </div>
      </div>

      {phase === "idle" && (
        <button onClick={() => void run()} className="btn-brand mt-3 w-full">
          Review my week
        </button>
      )}

      {phase === "running" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading your week.
        </p>
      )}

      {proposal && (phase === "proposed" || phase === "applying") && (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-relaxed">{proposal.reply}</p>

          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border px-2 py-1.5">
              <dt className="text-[11px] text-muted">Sessions</dt>
              <dd className="readout text-sm font-semibold">
                {proposal.week.sessionsLogged}/{proposal.week.sessionsPlanned}
              </dd>
            </div>
            <div className="rounded-lg border border-border px-2 py-1.5">
              <dt className="text-[11px] text-muted">Progressed</dt>
              <dd className="readout text-sm font-semibold">{proposal.week.progressed.length}</dd>
            </div>
            <div className="rounded-lg border border-border px-2 py-1.5">
              <dt className="text-[11px] text-muted">Stalled</dt>
              <dd className="readout text-sm font-semibold">{proposal.week.stalled.length}</dd>
            </div>
          </dl>

          {proposal.bigChange && (
            <p className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs leading-relaxed">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>
                This is a big change. It rewrites more than a third of your plan, so read it before
                you accept.
              </span>
            </p>
          )}

          {proposal.ops.length > 0 ? (
            <ul className="space-y-1.5">
              {proposal.ops.map((op, i) => (
                <li key={i} className="rounded-lg border border-border px-2.5 py-2">
                  <p className="text-xs leading-relaxed">{op.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">
              No changes suggested. Your plan stays as it is this week.
            </p>
          )}

          {proposal.dropped.length > 0 && (
            <ul className="space-y-1">
              {proposal.dropped.map((d, i) => (
                <li key={i} className="text-xs text-warning">
                  {d}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            {proposal.ops.length > 0 && (
              <button
                onClick={() => void send({ ops: proposal.ops, source: "weekly_review" })}
                disabled={phase === "applying"}
                className="btn-brand flex-1"
              >
                {phase === "applying" && <Loader2 className="h-4 w-4 animate-spin" />}
                Accept changes
              </button>
            )}
            <button
              onClick={() => {
                void send({ dismiss: true });
                setHidden(true);
              }}
              disabled={phase === "applying"}
              className="btn-ghost text-xs"
            >
              {proposal.ops.length > 0 ? "Keep my plan" : "Got it"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
