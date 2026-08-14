"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, Send } from "lucide-react";

/**
 * Talking to the coach about the active plan.
 *
 * Step 6 of docs/PLANNER_V2_DESIGN.md, and the founder's first complaint: the
 * plan could only be replaced, never edited, and they wanted it to feel like a
 * coach rather than a generator.
 *
 * Every turn is a patch, not a regeneration, so the rest of the plan is
 * untouched by construction and a change lands in a few seconds instead of the
 * 35 a rebuild takes.
 */

interface Turn {
  role: "athlete" | "coach";
  text: string;
  /** What actually changed, so the athlete sees it rather than trusting prose. */
  changes?: { reason: string }[];
  /** Asked for but not done. Never hidden. */
  problems?: string[];
}

const SUGGESTIONS = [
  "Swap the deadlift for something less taxing",
  "I only have 45 minutes on Fridays",
  "Give me more chest volume",
  "Why is this exercise first?",
];

export function PlanCoachChat({ hasPlan }: { hasPlan: boolean }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  if (!hasPlan) return null;

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setError(null);
    setDraft("");
    const nextTurns: Turn[] = [...turns, { role: "athlete", text }];
    setTurns(nextTurns);
    setBusy(true);
    try {
      // Send the whole dialogue so the coach remembers the conversation and can
      // ask a clarifying question before it edits. Coach turns become assistant
      // turns carrying what it said.
      const apiMessages = nextTurns.map((t) => ({
        role: t.role === "athlete" ? ("user" as const) : ("assistant" as const),
        content: t.text,
      }));
      const res = await fetch("/api/plan/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reply?: string;
        applied?: { reason: string }[];
        rejected?: { error: string }[];
        dropped?: string[];
        revision?: number | null;
      };
      if (!res.ok) throw new Error(body.error ?? "The coach could not answer.");

      const problems = [
        ...(body.rejected ?? []).map((r) => r.error),
        ...(body.dropped ?? []),
      ];
      setTurns((t) => [
        ...t,
        {
          role: "coach",
          text: body.reply || "Done.",
          changes: body.applied ?? [],
          problems,
        },
      ]);
      if (body.revision != null) {
        setCanUndo(true);
        // The plan is a server component, so pull the new version rather than
        // duplicating plan state in the client.
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not answer.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (undoing) return;
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/undo", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
      if (!res.ok) throw new Error(body.error ?? "Nothing to undo.");
      setTurns((t) => [...t, { role: "coach", text: body.summary ?? "Reverted the last change." }]);
      setCanUndo(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nothing to undo.");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Talk to your coach</h2>
          <p className="text-xs text-muted">
            Ask for a change, or ask why something is there. It edits this plan rather than
            rebuilding it.
          </p>
        </div>
        {canUndo && (
          <button
            onClick={() => void undo()}
            disabled={undoing}
            className="btn-ghost flex-shrink-0 text-xs"
          >
            {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Undo
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <div className="mb-3 space-y-2">
          {turns.map((turn, i) => (
            <div
              key={i}
              className={
                turn.role === "athlete"
                  ? "ml-auto max-w-[85%] rounded-xl bg-brand/10 px-3 py-2 text-sm text-brand"
                  : "mr-auto max-w-[92%] rounded-xl bg-surface-2 px-3 py-2 text-sm"
              }
            >
              <p className="leading-snug">{turn.text}</p>

              {/* What changed, listed rather than described, so the athlete can
                  check the words against the actions. */}
              {turn.changes && turn.changes.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted">
                  {turn.changes.map((c, j) => (
                    <li key={j}>{c.reason}</li>
                  ))}
                </ul>
              )}

              {turn.problems && turn.problems.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-warning/30 pt-2 text-xs text-warning">
                  {turn.problems.map((p, j) => (
                    <li key={j} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking about your plan
            </p>
          )}
        </div>
      )}

      {turns.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => void send(s)}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          className="input min-h-[44px] flex-1 resize-none py-2.5"
          rows={1}
          placeholder="Ask for a change"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, shift-enter breaks the line. A phone keyboard's
            // return key should do the obvious thing.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button
          onClick={() => void send(draft)}
          disabled={busy || !draft.trim()}
          className="btn-brand flex-shrink-0"
          aria-label="Send to your coach"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
