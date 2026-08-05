"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import type { PlanDayWithExercises } from "@/lib/types";
import { ExercisePicker, type PickerExercise } from "@/components/plan-exercise-picker";
import { styleProfile, type TrainingStyle } from "@/lib/training-style";

/**
 * Adding an exercise to a day, and renaming the day.
 *
 * The two ops the patch engine has always supported and the tap UI did not
 * expose, so the only way to reach either was to ask the coach in a sentence.
 *
 * Both post to /api/plan/edit, the same endpoint the weekly review and the
 * per-exercise controls use, so everything shares one revision history and one
 * undo.
 */

/** A sensible starting rep range. The athlete can change it on the next tap. */
const DEFAULT_REPS = { low: 8, high: 12 };

async function postOp(op: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/plan/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: [op], source: "athlete_direct" }),
  });
  const body = (await res.json()) as { error?: string; rejected?: { error: string }[] };
  if (!res.ok) throw new Error(body.error ?? "That change could not be saved.");
  // A rejected op is not a failed request, and it must not read like a success.
  if (body.rejected?.length) throw new Error(body.rejected[0].error);
}

export function AddExerciseToDay({
  day,
  library,
  trainingStyle,
}: {
  day: PlanDayWithExercises;
  library: PickerExercise[];
  trainingStyle: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The athlete's own answer decides sets and effort, not a house default.
  const style = styleProfile(trainingStyle as TrainingStyle | null);

  async function add(candidate: PickerExercise) {
    setBusy(true);
    setError(null);
    try {
      await postOp({
        op: "insert_exercise",
        dayIndex: day.day_index,
        // Appended, never inserted mid-day. Where a lift sits changes what it
        // does, so the athlete places it with the up and down controls rather
        // than the app guessing.
        position: day.exercises.length,
        exerciseId: candidate.id,
        sets: style.sets,
        repLow: DEFAULT_REPS.low,
        repHigh: DEFAULT_REPS.high,
        rpeTarget: style.rpe,
        reason: `You added ${candidate.name} to ${day.name}.`,
      });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {open ? (
        <ExercisePicker
          library={library}
          exclude={day.exercises.map((e) => e.exercise_id)}
          preferMuscle={null}
          placeholder="Search the library"
          disabled={busy}
          onClose={() => setOpen(false)}
          onPick={(candidate) => void add(candidate)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost mt-3 min-h-11 w-full text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Add an exercise
        </button>
      )}
      {open && (
        <p className="mt-2 text-[11px] text-muted">
          Added at the end with {style.sets} sets of {DEFAULT_REPS.low} to {DEFAULT_REPS.high} at RPE{" "}
          {style.rpe}. Tap it afterwards to change any of that.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function DayName({ day }: { day: PlanDayWithExercises }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(day.name);
  const [focus, setFocus] = useState(day.focus ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await postOp({
        op: "rename_day",
        dayIndex: day.day_index,
        name: name.trim(),
        focus: focus.trim() || null,
        reason: "You renamed this day.",
      });
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-start gap-1.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-lg font-semibold">{day.name}</span>
          {day.focus && <span className="block text-xs text-muted">{day.focus}</span>}
        </span>
        <Pencil className="mt-1.5 h-3 w-3 flex-shrink-0 text-muted" />
      </button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <input
        className="input"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        aria-label="Day name"
      />
      <input
        className="input"
        value={focus}
        maxLength={160}
        placeholder="What this day is for, optional"
        onChange={(e) => setFocus(e.target.value)}
        aria-label="Day focus"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
          className="btn-brand flex-1 text-xs"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setName(day.name);
            setFocus(day.focus ?? "");
            setEditing(false);
          }}
          className="btn-ghost min-h-11 px-2"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
