"use client";

import { useState } from "react";
import { X } from "lucide-react";

/**
 * Choosing an exercise from the library, for a swap or for an add.
 *
 * Shared rather than duplicated: both callers want the same filtering rule and
 * the same phone-sized list, and two copies would drift the moment one of them
 * gained a filter.
 */

/** Slimmed library rows. The full Exercise type carries columns a picker never needs. */
export interface PickerExercise {
  id: string;
  name: string;
  muscle_group: string;
}

const MAX_RESULTS = 8;

export function ExercisePicker({
  library,
  exclude,
  /** Shown first when the box is empty. Null lists the whole library instead. */
  preferMuscle,
  placeholder,
  disabled,
  onPick,
  onClose,
}: {
  library: PickerExercise[];
  exclude: string[];
  preferMuscle: string | null;
  placeholder: string;
  disabled?: boolean;
  onPick: (exercise: PickerExercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const excluded = new Set(exclude);

  const matches = library
    .filter((e) => !excluded.has(e.id))
    .filter((e) =>
      term
        ? e.name.toLowerCase().includes(term)
        : preferMuscle == null || e.muscle_group === preferMuscle,
    );
  const shown = matches.slice(0, MAX_RESULTS);
  const hidden = matches.length - shown.length;

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          className="input flex-1"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost min-h-11 px-2">
          <X className="h-4 w-4" />
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-muted">Nothing matches that in your equipment.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(candidate)}
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

      {/* A truncated list that says nothing reads like the whole library. */}
      {hidden > 0 && (
        <p className="text-[11px] text-muted">
          {hidden} more. Type to narrow it down.
        </p>
      )}
    </div>
  );
}
