"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { liftClaimToKg } from "@/lib/athlete-lifts";
import type { Units } from "@/lib/types";

/**
 * Asking a new athlete what they can lift.
 *
 * Step 3 of docs/PLANNER_V2_DESIGN.md, and the founder's second complaint: the
 * app knew nothing about a first-time user, so it handed them a generic plan.
 *
 * Weight and reps, never a 1RM. Nobody knows their true 1RM and asking for one
 * invites a made-up number, which the whole app is built to avoid. Every
 * question is skippable, individually and as a set, because friction here loses
 * the athlete before they ever see a plan.
 */

export interface LiftQuestion {
  exerciseId: string;
  name: string;
  covers: string;
  weight: string;
  reps: string;
}

export function LiftIntake({
  questions,
  units,
  onDone,
}: {
  questions: LiftQuestion[];
  units: Units;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<LiftQuestion[]>(questions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const answered = rows.filter((r) => r.weight.trim() && r.reps.trim()).length;

  function update(index: number, field: "weight" | "reps", value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  async function save(skipAll = false) {
    setSaving(true);
    setError(null);
    try {
      const lifts = skipAll
        ? []
        : rows
            .filter((r) => r.weight.trim() && r.reps.trim())
            .map((r) =>
              liftClaimToKg(
                {
                  exerciseId: r.exerciseId,
                  weight: Number(r.weight),
                  reps: Number(r.reps),
                },
                units,
              ),
            );
      const res = await fetch("/api/athlete-lifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifts }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save those.");
      }
      setDismissed(true);
      router.refresh();
      onDone?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save those.");
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0 || dismissed) return null;

  return (
    <div className="card">
      <h2 className="text-sm font-semibold">What can you lift?</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        A rough best for any of these lets your coach see which muscles are ahead and which are
        behind. Give the heaviest set you are confident about, not a true one rep max. Skip
        anything you do not know.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((row, i) => (
          <div key={row.exerciseId} className="grid grid-cols-[1fr_4.5rem_4rem] items-center gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.name}</p>
              <p className="truncate text-[11px] text-muted">{row.covers}</p>
            </div>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              className="input readout text-center"
              placeholder={units}
              value={row.weight}
              onChange={(e) => update(i, "weight", e.target.value)}
              aria-label={`${row.name} weight`}
            />
            <input
              type="number"
              inputMode="numeric"
              className="input readout text-center"
              placeholder="reps"
              value={row.reps}
              onChange={(e) => update(i, "reps", e.target.value)}
              aria-label={`${row.name} reps`}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => void save(false)}
          disabled={saving || answered === 0}
          className="btn-brand flex-1"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          {`Save ${answered || ""}`.trim()}
        </button>
        {/* Skipping is a first-class answer, not a hidden escape. */}
        <button onClick={() => void save(true)} disabled={saving} className="btn-ghost text-xs">
          Skip for now
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
