// Next-session targets — the actual coaching output. For each lift we look at
// the most recent session's top working set and apply RPE-based double
// progression: easy sets earn load, hard sets repeat for reps, near-maximal sets
// hold, and when a deload is recommended every lift backs off together.
//
// This is intentionally transparent and rule-based (no LLM, instant, free); the
// AI coach explains and adapts it, but the numbers come from here.

import type { TrainingSet, Units } from "@/lib/types";
import { estimate1RM, round1 } from "./epley";

export type ProgressionAction = "progress" | "hold" | "back_off" | "deload";

export interface NextSession {
  exerciseId: string;
  exerciseName: string;
  isMajor: boolean;
  last: { weight: number; reps: number; rpe: number | null; sets: number };
  target: { weight: number; reps: number; sets: number };
  action: ProgressionAction;
  note: string;
}

// Big compound lower-body / pulling lifts progress in larger jumps than small
// isolation work.
const BIG_LIFT = /squat|deadlift|leg press|hip thrust|rack pull/i;

function increment(units: Units, name: string): number {
  if (BIG_LIFT.test(name)) return units === "kg" ? 5 : 10;
  return units === "kg" ? 2.5 : 5;
}
const plateStep = (units: Units) => (units === "kg" ? 2.5 : 5);
const roundTo = (w: number, step: number) => Math.round(w / step) * step;

export function buildNextSessions(
  sets: TrainingSet[],
  opts: { units?: Units; deload?: boolean } = {},
): NextSession[] {
  const units = opts.units ?? "kg";

  const byEx = new Map<string, TrainingSet[]>();
  for (const s of sets) {
    const arr = byEx.get(s.exerciseId) ?? [];
    arr.push(s);
    byEx.set(s.exerciseId, arr);
  }

  const out: NextSession[] = [];
  for (const [exerciseId, exSets] of byEx) {
    // Most recent session for this lift.
    let latestSession = "";
    let latestDate = "";
    for (const s of exSets) {
      if (s.date > latestDate) {
        latestDate = s.date;
        latestSession = s.sessionId;
      }
    }
    const sessionSets = exSets.filter((s) => s.sessionId === latestSession);
    if (sessionSets.length === 0) continue;

    // Top working set by estimated 1RM.
    let top = sessionSets[0];
    for (const s of sessionSets) {
      if (estimate1RM(s.weight, s.reps) > estimate1RM(top.weight, top.reps)) top = s;
    }
    const rpes = sessionSets.map((s) => s.rpe).filter((r): r is number => r != null);
    const rpe = top.rpe ?? (rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null);
    const setCount = sessionSets.length;
    const meta = sessionSets[0];

    const incr = increment(units, meta.exerciseName);
    const step = plateStep(units);

    let action: ProgressionAction;
    let target: NextSession["target"];
    let note: string;

    if (opts.deload) {
      action = "deload";
      target = {
        weight: roundTo(top.weight * 0.85, step),
        reps: top.reps,
        sets: Math.max(1, Math.ceil(setCount / 2)),
      };
      note = "Deload week, about 15% lighter, keep it at RPE 6 or below, half the sets. Recover, then rebuild.";
    } else if (rpe == null) {
      action = "progress";
      target = { weight: roundTo(top.weight + incr, step), reps: top.reps, sets: setCount };
      note = `No RPE logged, a small bump. Log RPE next time for sharper targets.`;
    } else if (rpe <= 7.5) {
      action = "progress";
      target = { weight: roundTo(top.weight + incr, step), reps: top.reps, sets: setCount };
      note = `Felt easy (RPE ${round1(rpe)}), add ${incr}${units}.`;
    } else if (rpe <= 8.5) {
      action = "hold";
      target = { weight: top.weight, reps: top.reps + 1, sets: setCount };
      note = `Solid (RPE ${round1(rpe)}), repeat the weight, chase +1 rep.`;
    } else {
      action = "back_off";
      target = { weight: top.weight, reps: top.reps, sets: setCount };
      note = `Near-maximal (RPE ${round1(rpe)}), hold here until it moves faster.`;
    }

    out.push({
      exerciseId,
      exerciseName: meta.exerciseName,
      isMajor: meta.isMajor,
      last: { weight: top.weight, reps: top.reps, rpe: top.rpe, sets: setCount },
      target,
      action,
      note,
    });
  }

  out.sort((a, b) =>
    a.isMajor !== b.isMajor ? (a.isMajor ? -1 : 1) : a.exerciseName.localeCompare(b.exerciseName),
  );
  return out;
}
