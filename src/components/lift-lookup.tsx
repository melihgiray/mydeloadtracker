"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { ProgressStatus, Units } from "@/lib/types";
import type { WeeklyExercisePoint } from "@/lib/analytics/progress";
import { aliasesFor } from "@/lib/exercise-aliases";
import { exerciseColor, exerciseGlyph } from "@/lib/exercise-visual";
import { IconBadge } from "@/components/icon-badge";
import { StatusBadge } from "@/components/status-badge";
import { ExerciseTrend } from "@/components/exercise-trend";

export interface LiftDetail {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  movementPattern: string | null;
  isMajor: boolean;
  status: ProgressStatus;
  changePct: number;
  currentE1RM: number;
  weeks: WeeklyExercisePoint[];
  prE1RM: number;
  maxWeight: number;
}

/**
 * Search any logged lift and see its estimated-1RM trend and personal records.
 * Replaces the old all-exercises lists, which grew without bound.
 */
export function LiftLookup({ lifts, units }: { lifts: LiftDetail[]; units: Units }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(
    () => (lifts.find((l) => l.isMajor) ?? lifts[0])?.exerciseId ?? "",
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return lifts
      .map((l) => {
        let score = -1;
        for (const term of [l.name, ...aliasesFor(l.name)]) {
          const t = term.toLowerCase();
          if (t.startsWith(q)) score = Math.max(score, 80);
          else if (t.includes(q)) score = Math.max(score, 60);
        }
        if (score < 0 && l.muscleGroup.toLowerCase().includes(q)) score = 40;
        return { l, score };
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score || a.l.name.length - b.l.name.length)
      .slice(0, 10)
      .map((s) => s.l);
  }, [lifts, query]);

  const selected = lifts.find((l) => l.exerciseId === selectedId) ?? lifts[0];

  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2.5">
        <IconBadge icon={Search} color="indigo" size="sm" />
        <h2 className="font-semibold">Look up a lift</h2>
        <span className="micro ml-auto">trend + records</span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input pl-10 pr-10"
          inputMode="search"
          autoComplete="off"
          placeholder={`Search ${lifts.length} of your lifts`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              setSelectedId(results[0].exerciseId);
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="mt-2 max-h-[40vh] overflow-auto rounded-xl border border-border scroll-thin">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No lift matches that.</p>
          ) : (
            results.map((l) => (
              <button
                key={l.exerciseId}
                onClick={() => {
                  setSelectedId(l.exerciseId);
                  setQuery("");
                }}
                className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-hover"
              >
                <IconBadge
                  icon={exerciseGlyph({ movement_pattern: l.movementPattern, muscle_group: l.muscleGroup })}
                  color={exerciseColor(l.muscleGroup)}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <span className="readout flex-shrink-0 text-xs text-muted">
                  {l.currentE1RM} {units}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {selected && !query.trim() && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <IconBadge
              icon={exerciseGlyph({ movement_pattern: selected.movementPattern, muscle_group: selected.muscleGroup })}
              color={exerciseColor(selected.muscleGroup)}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 font-semibold leading-tight">
                {selected.name}
                {selected.isMajor && (
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                    MAJOR
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted">{selected.muscleGroup}</p>
            </div>
            <StatusBadge status={selected.status} changePct={selected.changePct} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-background/60 p-3">
              <span className="micro">Current e1RM</span>
              <div className="readout mt-1 text-2xl font-semibold">
                {selected.currentE1RM}
                <span className="ml-1 font-sans text-sm font-normal text-muted">{units}</span>
              </div>
            </div>
            <div className="rounded-xl bg-background/60 p-3">
              <span className="micro">Best ever</span>
              <div className="readout mt-1 text-2xl font-semibold">
                {selected.prE1RM}
                <span className="ml-1 font-sans text-sm font-normal text-muted">{units}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted">top set {selected.maxWeight} {units}</p>
            </div>
          </div>

          <div className="mt-4">
            <ExerciseTrend weeks={selected.weeks} />
          </div>
        </div>
      )}
    </div>
  );
}
