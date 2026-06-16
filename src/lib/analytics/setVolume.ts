// Hard-set volume — the hypertrophy-dose view of training volume.
//
// WHY THIS EXISTS (and how it differs from volume.ts): `volume.ts` tracks
// *volume load* = Σ(weight × reps) — tonnage. Tonnage is a fine work/output
// proxy for strength athletes, but it's a poor dose metric for muscle growth: it
// is dominated by the heaviest lifts (a 200kg squat dwarfs a 20kg lateral raise
// in tonnage despite a similar growth stimulus per set) and conflates intensity
// with volume. The resistance-training literature (Schoenfeld et al. dose-
// response; Renaissance Periodization set landmarks) finds the best *simple*
// hypertrophy dose is the **number of hard sets per muscle per week**, with a
// productive range of roughly **10–20 sets/muscle/week**.
//
// So we keep tonnage AND add this. A "hard set" = a working set: we count a set
// unless it's explicitly logged at RPE < 7 (i.e. a warm-up). Sets count toward
// their exercise's primary `muscle_group` only (a compound like bench counts to
// Chest, not also Triceps/Shoulders) — the standard direct-set convention.

import type { TrainingSet } from "@/lib/types";
import { recentWeekKeys, weekKey, weekLabel } from "./dates";

export type SetVolumeStatus = "low" | "building" | "optimal" | "high";

export interface MuscleSetSummary {
  muscleGroup: string;
  /** Trailing-window average hard sets per week (1dp). */
  setsPerWeek: number;
  /** Hard sets logged in the current (in-progress) week. */
  thisWeek: number;
  status: SetVolumeStatus;
  note: string;
}

export interface WeeklySetRow {
  week: string;
  label: string;
  total: number;
  [muscleGroup: string]: number | string;
}

export interface SetVolumeReport {
  muscles: MuscleSetSummary[];
  rows: WeeklySetRow[]; // weekly hard-set counts per muscle (for a chart)
  muscleGroups: string[];
  windowWeeks: number; // weeks used for the per-week average
}

// Weekly direct-set landmarks per muscle group. Productive hypertrophy range is
// ~10-20 hard sets/week; below ~6 is roughly maintenance; above ~22 risks
// exceeding what most can recover from (junk volume).
const LOW = 6;
const OPTIMAL_MIN = 10;
export const OPTIMAL_MAX = 20;
const HIGH = 22;

function classify(setsPerWeek: number): { status: SetVolumeStatus; note: string } {
  if (setsPerWeek < LOW) return { status: "low", note: "maintenance, below the growth range" };
  if (setsPerWeek < OPTIMAL_MIN) return { status: "building", note: "approaching the 10 to 20 set range" };
  if (setsPerWeek <= HIGH) return { status: "optimal", note: "in the 10 to 20 set hypertrophy range" };
  return { status: "high", note: "above 22 sets, watch recovery" };
}

/** A working ("hard") set: counted unless explicitly logged below RPE 7. */
function isHardSet(s: TrainingSet): boolean {
  return s.rpe == null || s.rpe >= 7;
}

export function buildSetVolume(
  sets: TrainingSet[],
  windowWeeks = 4,
  chartWeeks = 8,
  now: Date = new Date(),
): SetVolumeReport {
  const chartKeys = recentWeekKeys(chartWeeks, now);
  const windowKeys = new Set(recentWeekKeys(windowWeeks, now));
  const thisWeek = weekKey(now);

  const groups = new Set<string>();
  const grid = new Map<string, Map<string, number>>(); // week -> mg -> hard-set count
  for (const k of chartKeys) grid.set(k, new Map());

  const windowCount = new Map<string, number>();
  const thisWeekCount = new Map<string, number>();

  for (const s of sets) {
    if (!isHardSet(s)) continue;
    const k = weekKey(s.date);
    groups.add(s.muscleGroup);
    grid.get(k)?.set(s.muscleGroup, (grid.get(k)!.get(s.muscleGroup) ?? 0) + 1);
    if (windowKeys.has(k)) windowCount.set(s.muscleGroup, (windowCount.get(s.muscleGroup) ?? 0) + 1);
    if (k === thisWeek) thisWeekCount.set(s.muscleGroup, (thisWeekCount.get(s.muscleGroup) ?? 0) + 1);
  }

  const muscleGroups = [...groups].sort();

  const rows: WeeklySetRow[] = chartKeys.map((week) => {
    const row: WeeklySetRow = { week, label: weekLabel(week), total: 0 };
    let total = 0;
    for (const mg of muscleGroups) {
      const v = grid.get(week)?.get(mg) ?? 0;
      row[mg] = v;
      total += v;
    }
    row.total = total;
    return row;
  });

  const muscles: MuscleSetSummary[] = muscleGroups
    .map((mg) => {
      const setsPerWeek = Math.round(((windowCount.get(mg) ?? 0) / windowWeeks) * 10) / 10;
      const { status, note } = classify(setsPerWeek);
      return { muscleGroup: mg, setsPerWeek, thisWeek: thisWeekCount.get(mg) ?? 0, status, note };
    })
    .filter((m) => m.setsPerWeek > 0 || m.thisWeek > 0)
    .sort((a, b) => b.setsPerWeek - a.setsPerWeek);

  return { muscles, rows, muscleGroups, windowWeeks };
}
