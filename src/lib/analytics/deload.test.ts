// Signal-level tests for the deload detector — the product's core thesis.
// Prior coverage only smoke-tested detectDeload via the demo sample; these pin
// each of the three signals' thresholds and the 2-of-3 recommendation rule.

import { describe, it, expect } from "vitest";
import { detectDeload, type SignalId } from "@/lib/analytics/deload";
import type { TrainingSet } from "@/lib/types";

const now = new Date("2026-06-08T12:00:00");

// A set placed `weeksAgo` weeks before `now` (same weekday => distinct training
// week). Multiple sessionIds in one week model multiple sessions that week.
function set(
  weeksAgo: number,
  opts: {
    sessionId: string;
    exerciseId: string;
    name: string;
    isMajor: boolean;
    weight: number;
    reps?: number;
    rpe?: number | null;
    muscleGroup?: string;
  },
): TrainingSet {
  const d = new Date(now);
  d.setDate(d.getDate() - weeksAgo * 7);
  d.setHours(12, 0, 0, 0);
  return {
    date: d.toISOString(),
    sessionId: opts.sessionId,
    exerciseId: opts.exerciseId,
    exerciseName: opts.name,
    muscleGroup: opts.muscleGroup ?? "Legs",
    isMajor: opts.isMajor,
    reps: opts.reps ?? 5,
    weight: opts.weight,
    rpe: opts.rpe ?? 8,
  };
}

function signal(sets: TrainingSet[], id: SignalId) {
  return detectDeload(sets, now).signals.find((s) => s.id === id)!;
}

/** A major lift trained across all 6 weeks; `weightAt(week)` sets the load. */
function majorAcrossWindow(
  exerciseId: string,
  name: string,
  weightAt: (weeksAgo: number) => number,
  rpeAt: (weeksAgo: number) => number = () => 8,
): TrainingSet[] {
  const out: TrainingSet[] = [];
  for (let k = 5; k >= 0; k--) {
    out.push(
      set(k, {
        sessionId: `${exerciseId}-w${k}`,
        exerciseId,
        name,
        isMajor: true,
        weight: weightAt(k),
        rpe: rpeAt(k),
      }),
    );
  }
  return out;
}

describe("detectDeload — empty & baseline", () => {
  it("recommends nothing and fires no signals with no data", () => {
    const report = detectDeload([], now);
    expect(report.recommended).toBe(false);
    expect(report.triggeredCount).toBe(0);
    expect(report.signals.every((s) => !s.triggered)).toBe(true);
  });
});

describe("signal (a): stalled major lifts", () => {
  it("fires when 2+ majors are flat for 3+ weeks", () => {
    const sets = [
      ...majorAcrossWindow("squat", "Squat", () => 100),
      ...majorAcrossWindow("bench", "Bench Press", () => 80),
    ];
    expect(signal(sets, "stalled_majors").triggered).toBe(true);
  });

  it("does NOT fire when only one major is stalled", () => {
    const sets = [
      ...majorAcrossWindow("squat", "Squat", () => 100), // flat -> stalled
      ...majorAcrossWindow("bench", "Bench Press", (k) => 80 + (5 - k) * 2.5), // rising
    ];
    expect(signal(sets, "stalled_majors").triggered).toBe(false);
  });

  it("does NOT fire when majors keep progressing", () => {
    const sets = [
      ...majorAcrossWindow("squat", "Squat", (k) => 100 + (5 - k) * 5),
      ...majorAcrossWindow("bench", "Bench Press", (k) => 80 + (5 - k) * 2.5),
    ];
    expect(signal(sets, "stalled_majors").triggered).toBe(false);
  });
});

describe("signal (b): rising RPE at a flat load", () => {
  it("fires when RPE climbs 1.5+ with no added weight", () => {
    // RPE 7 -> 9 across the window at a constant 100.
    const sets = majorAcrossWindow("ohp", "Overhead Press", () => 100, (k) => 7 + (5 - k) * 0.4);
    expect(signal(sets, "rising_rpe").triggered).toBe(true);
  });

  it("does NOT fire when the weight also went up", () => {
    const sets = majorAcrossWindow(
      "ohp",
      "Overhead Press",
      (k) => 100 + (5 - k) * 2, // load increased
      (k) => 7 + (5 - k) * 0.4, // effort also up, but earned
    );
    expect(signal(sets, "rising_rpe").triggered).toBe(false);
  });
});

describe("signal (c): dropping session frequency", () => {
  // 3 sessions/wk for the prior 4 weeks, then 1 session/wk for the last 2.
  function withFrequency(hasMajors: boolean): TrainingSet[] {
    const out: TrainingSet[] = [];
    for (let k = 5; k >= 0; k--) {
      const sessionsThisWeek = k >= 2 ? 3 : 1; // prior4 => 3, last2 => 1
      for (let s = 0; s < sessionsThisWeek; s++) {
        out.push(
          set(k, {
            sessionId: `w${k}-s${s}`,
            exerciseId: "acc",
            name: "Leg Press",
            isMajor: hasMajors,
            weight: 120,
          }),
        );
      }
    }
    return out;
  }

  it("fires when the last 2 weeks drop below the prior 4-week average", () => {
    expect(signal(withFrequency(false), "dropping_frequency").triggered).toBe(true);
  });

  it("does NOT fire for a brand-new athlete with no prior baseline", () => {
    // Only the last 2 weeks have any sessions at all.
    const sets = [
      set(1, { sessionId: "n1", exerciseId: "acc", name: "Leg Press", isMajor: false, weight: 120 }),
      set(0, { sessionId: "n2", exerciseId: "acc", name: "Leg Press", isMajor: false, weight: 120 }),
    ];
    expect(signal(sets, "dropping_frequency").triggered).toBe(false);
  });
});

describe("recommendation rule (2 of 3)", () => {
  it("does NOT recommend on a single firing signal", () => {
    // Frequency drop only, no majors so signal (a) can't fire.
    const out: TrainingSet[] = [];
    for (let k = 5; k >= 0; k--) {
      const n = k >= 2 ? 3 : 1;
      for (let s = 0; s < n; s++) {
        out.push(set(k, { sessionId: `w${k}-s${s}`, exerciseId: "acc", name: "Leg Press", isMajor: false, weight: 120 }));
      }
    }
    const report = detectDeload(out, now);
    expect(report.triggeredCount).toBe(1);
    expect(report.recommended).toBe(false);
  });

  it("recommends when two signals fire (stalled majors + frequency drop)", () => {
    const out: TrainingSet[] = [];
    for (let k = 5; k >= 0; k--) {
      // Main session every week: two flat majors -> signal (a).
      out.push(set(k, { sessionId: `main-w${k}`, exerciseId: "squat", name: "Squat", isMajor: true, weight: 100 }));
      out.push(set(k, { sessionId: `main-w${k}`, exerciseId: "bench", name: "Bench Press", isMajor: true, weight: 80 }));
      // Two extra accessory sessions only in the prior 4 weeks -> signal (c).
      if (k >= 2) {
        out.push(set(k, { sessionId: `acc1-w${k}`, exerciseId: "acc", name: "Leg Press", isMajor: false, weight: 120 }));
        out.push(set(k, { sessionId: `acc2-w${k}`, exerciseId: "curl", name: "Cable Curl", isMajor: false, weight: 20, muscleGroup: "Biceps" }));
      }
    }
    const report = detectDeload(out, now);
    expect(report.signals.find((s) => s.id === "stalled_majors")!.triggered).toBe(true);
    expect(report.signals.find((s) => s.id === "dropping_frequency")!.triggered).toBe(true);
    expect(report.triggeredCount).toBeGreaterThanOrEqual(2);
    expect(report.recommended).toBe(true);
  });
});
