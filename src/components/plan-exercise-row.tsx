"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Repeat, Trash2, X } from "lucide-react";
import type { PlanDayWithExercises } from "@/lib/types";

/**
 * Tap an exercise to change it.
 *
 * The rest of step 2 in docs/PLANNER_V2_DESIGN.md. The engine, the revision
 * history and the undo have been in place since the chat shipped; this is the
 * direct path to the same ops, for the athlete who does not want to type a
 * sentence to move one lift.
 *
 * Everything goes through /api/plan/edit, which is also what the weekly review
 * accepts through. One apply path means one revision history and one undo.
 */

/** Slimmed library rows. The full Exercise type carries columns a picker never needs. */
export interface PickerExercise {
  id: string;
  name: string;
  muscle_group: string;
}

interface Props {
  day: PlanDayWithExercises;
  exercise: PlanDayWithExercises["exercises"][number];
  index: number;
  count: number;
  library: PickerExercise[];
}

type Panel = "none" | "edit" | "swap";

export function PlanExerciseRow({ day, exercise, index, count, library }: Props) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sets, setSets] = useState(exercise.sets);
  const [repLow, setRepLow] = useState(exercise.rep_low);
  const [repHigh, setRepHigh] = useState(exercise.rep_high);
  const [query, setQuery] = useState("");

  async function send(op: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: [op], source: "athlete_direct" }),
      });
      const body = (await res.json()) as {
        error?: string;
        rejected?: { error: string }[];
      };
      if (!res.ok) throw new Error(body.error ?? "That change could not be saved.");
      // A rejected op is not a failed request, and it must not read like a
      // success. The engine's own wording is the clearest thing to show.
      if (body.rejected?.length) throw new Error(body.rejected[0].error);
      setPanel("none");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const base = { dayIndex: day.day_index, position: exercise.position };
  const dirty = sets !== exercise.sets || repLow !== exercise.rep_low || repHigh !== exercise.rep_high;

  // Same muscle first, because a swap is nearly always for a variant of the
  // same thing. Everything else stays reachable through the search box.
  const matches = library
    .filter((e) => e.id !== exercise.exercise_id)
    .filter((e) =>
      query.trim()
        ? e.name.toLowerCase().includes(query.trim().toLowerCase())
        : e.muscle_group === exercise.muscle_group,
    )
    .slice(0, 8);

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={() => setPanel(panel === "none" ? "edit" : "none")}
        aria-expanded={panel !== "none"}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{exercise.name}</p>
          <p className="text-xs text-muted">{exercise.muscle_group}</p>
        </div>
        <p className="flex-shrink-0 text-sm font-semibold tabular-nums">
          {exercise.sets} x {exercise.rep_low}
          {exercise.rep_high !== exercise.rep_low && ` to ${exercise.rep_high}`}
          {exercise.rpe_target != null && (
            <span className="font-normal text-muted"> at RPE {exercise.rpe_target}</span>
          )}
        </p>
      </button>

      {panel === "edit" && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-[11px] text-muted">
              Sets
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                className="input readout text-center"
                value={sets}
                onChange={(e) => setSets(Number(e.target.value))}
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted">
              Reps from
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                className="input readout text-center"
                value={repLow}
                onChange={(e) => setRepLow(Number(e.target.value))}
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted">
              Reps to
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                className="input readout text-center"
                value={repHigh}
                onChange={(e) => setRepHigh(Number(e.target.value))}
              />
            </label>
          </div>

          {dirty && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void send({
                  op: "set_prescription",
                  ...base,
                  sets,
                  repLow,
                  repHigh,
                  reason: "You set this yourself.",
                })
              }
              className="btn-brand w-full"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPanel("swap")}
              className="btn-ghost min-h-11 text-xs"
            >
              <Repeat className="h-3.5 w-3.5" />
              Swap
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void send({ op: "remove_exercise", ...base, reason: "You removed this." })
              }
              className="btn-ghost min-h-11 text-xs text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
            <button
              type="button"
              disabled={busy || index === 0}
              onClick={() =>
                void send({
                  op: "reorder",
                  dayIndex: day.day_index,
                  fromPosition: exercise.position,
                  toPosition: day.exercises[index - 1].position,
                  reason: "You moved this up.",
                })
              }
              className="btn-ghost min-h-11 text-xs disabled:opacity-40"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Up
            </button>
            <button
              type="button"
              disabled={busy || index === count - 1}
              onClick={() =>
                void send({
                  op: "reorder",
                  dayIndex: day.day_index,
                  fromPosition: exercise.position,
                  toPosition: day.exercises[index + 1].position,
                  reason: "You moved this down.",
                })
              }
              className="btn-ghost min-h-11 text-xs disabled:opacity-40"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Down
            </button>
          </div>
        </div>
      )}

      {panel === "swap" && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <input
              type="search"
              className="input flex-1"
              placeholder={`Search, or pick a ${exercise.muscle_group.toLowerCase()} lift`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setPanel("edit")}
              aria-label="Close swap"
              className="btn-ghost min-h-11 px-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {matches.length === 0 ? (
            <p className="text-xs text-muted">Nothing matches that in your equipment.</p>
          ) : (
            <ul className="space-y-1">
              {matches.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send({
                        op: "replace_exercise",
                        ...base,
                        exerciseId: candidate.id,
                        reason: `You swapped ${exercise.name} for ${candidate.name}.`,
                      })
                    }
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border px-3 text-left"
                  >
                    <span className="truncate text-sm">{candidate.name}</span>
                    <span className="flex-shrink-0 text-[11px] text-muted">
                      {candidate.muscle_group}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
