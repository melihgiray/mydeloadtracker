// Sample athlete for the public /demo page — a realistic 8-week intermediate
// lifter whose data is shaped to exercise every feature: three major lifts stall
// and effort climbs (deload fires), training frequency drops in the last 2 weeks,
// and recovery markers (sleep, HRV, resting HR) degrade recently. Pure functions
// of `now`, so the demo always shows a fresh window ending today and never goes
// stale. No DB, no auth.

import type { DailyCheckin, TrainingSet } from "@/lib/types";
import { localDateKey, startOfWeek } from "./dates";

export const SAMPLE_BODYWEIGHT = 85;
export const SAMPLE_SEX = "male" as const;
export const SAMPLE_UNITS = "kg" as const;
export const SAMPLE_NAME = "Sample Athlete";

interface PlannedLift {
  name: string;
  muscleGroup: string;
  isMajor: boolean;
  reps: number;
  sets: number;
  weights: number[]; // length 8, oldest -> newest week
  rpe: number[];
}

const ramp = (v: number, step = 0): number[] => Array.from({ length: 8 }, (_, i) => v + i * step);

const MAJORS: PlannedLift[] = [
  { name: "Barbell Back Squat", muscleGroup: "Quads", isMajor: true, reps: 5, sets: 3,
    weights: [100, 105, 110, 115, 117.5, 117.5, 117.5, 117.5], rpe: [7, 7.5, 8, 8, 8.5, 9, 9, 9.5] },
  { name: "Barbell Bench Press", muscleGroup: "Chest", isMajor: true, reps: 5, sets: 3,
    weights: [70, 72.5, 75, 77.5, 78, 78, 78, 78], rpe: [7, 7.5, 8, 8.5, 9, 9, 9.5, 9.5] },
  { name: "Conventional Deadlift", muscleGroup: "Back", isMajor: true, reps: 3, sets: 2,
    weights: [140, 145, 150, 155, 160, 162.5, 165, 167.5], rpe: [7, 7.5, 8, 8, 8.5, 8.5, 9, 9] },
  { name: "Overhead Press", muscleGroup: "Shoulders", isMajor: true, reps: 5, sets: 3,
    weights: [47.5, 48, 50, 50, 50, 50, 50, 50], rpe: [7, 7, 7.5, 8, 8.5, 9, 9, 9.5] },
];

const ACCESSORIES: PlannedLift[] = [
  { name: "Leg Press", muscleGroup: "Quads", isMajor: false, reps: 10, sets: 3, weights: ramp(160, 2.5), rpe: ramp(7, 0.2) },
  { name: "Leg Curl", muscleGroup: "Hamstrings", isMajor: false, reps: 10, sets: 3, weights: ramp(40, 1), rpe: ramp(7, 0.2) },
  { name: "Standing Calf Raise", muscleGroup: "Calves", isMajor: false, reps: 12, sets: 3, weights: ramp(80, 1), rpe: ramp(8, 0.1) },
  { name: "Lat Pulldown", muscleGroup: "Back", isMajor: false, reps: 10, sets: 3, weights: ramp(55, 1), rpe: ramp(7, 0.2) },
  { name: "Barbell Row", muscleGroup: "Back", isMajor: false, reps: 8, sets: 3, weights: ramp(60, 1), rpe: ramp(7.5, 0.1) },
  { name: "Triceps Pushdown", muscleGroup: "Triceps", isMajor: false, reps: 12, sets: 3, weights: ramp(25, 0.5), rpe: ramp(7, 0.2) },
  { name: "Lateral Raise", muscleGroup: "Shoulders", isMajor: false, reps: 15, sets: 3, weights: ramp(12, 0.25), rpe: ramp(8, 0.1) },
  { name: "Barbell Curl", muscleGroup: "Biceps", isMajor: false, reps: 10, sets: 3, weights: ramp(25, 0.5), rpe: ramp(7.5, 0.1) },
  { name: "Hanging Leg Raise", muscleGroup: "Core", isMajor: false, reps: 12, sets: 3, weights: ramp(0, 0), rpe: ramp(7, 0.1) },
];

const PLAN = new Map([...MAJORS, ...ACCESSORIES].map((l) => [l.name, l]));

// 4 sessions/week (offset from Monday) and the lifts in each.
const TEMPLATE: { dayOffset: number; lifts: string[] }[] = [
  { dayOffset: 0, lifts: ["Barbell Back Squat", "Leg Press", "Leg Curl", "Standing Calf Raise"] },
  { dayOffset: 1, lifts: ["Barbell Bench Press", "Triceps Pushdown", "Lat Pulldown", "Lateral Raise"] },
  { dayOffset: 3, lifts: ["Conventional Deadlift", "Barbell Row"] },
  { dayOffset: 4, lifts: ["Overhead Press", "Barbell Curl", "Hanging Leg Raise"] },
];

export function buildSampleSets(now: Date = new Date()): TrainingSet[] {
  const thisMonday = startOfWeek(now);
  const out: TrainingSet[] = [];

  for (let week = 0; week < 8; week++) {
    const weeksAgo = 7 - week;
    // Last 2 weeks: only the first 2 sessions -> frequency drop (deload signal c).
    const sessions = week >= 6 ? TEMPLATE.slice(0, 2) : TEMPLATE;
    for (const day of sessions) {
      const performed = new Date(thisMonday);
      performed.setDate(performed.getDate() - weeksAgo * 7 + day.dayOffset);
      performed.setHours(18, 0, 0, 0);
      const sessionId = `demo-w${week}-d${day.dayOffset}`;
      for (const liftName of day.lifts) {
        const p = PLAN.get(liftName);
        if (!p) continue;
        for (let s = 1; s <= p.sets; s++) {
          out.push({
            date: performed.toISOString(),
            sessionId,
            exerciseId: p.name,
            exerciseName: p.name,
            muscleGroup: p.muscleGroup,
            isMajor: p.isMajor,
            reps: p.reps,
            weight: p.weights[week],
            rpe: p.rpe[week],
          });
        }
      }
    }
  }
  return out;
}

// 28 days of check-ins: good recovery baseline, then a clear recent dip (poor
// sleep, high soreness, HRV down ~20%, resting HR up ~8 bpm) so the recovery
// factors fire alongside the training-based deload signals.
export function buildSampleCheckins(now: Date = new Date()): DailyCheckin[] {
  const out: DailyCheckin[] = [];
  for (let offset = 0; offset < 28; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const date = localDateKey(d);
    const recent = offset <= 6;
    const iso = `${date}T08:00:00.000Z`;
    out.push({
      id: `demo-ci-${offset}`,
      user_id: "demo",
      date,
      sleep_quality: recent ? (offset <= 2 ? 2 : 3) : 4,
      soreness: recent ? 4 : 2,
      motivation: recent ? 3 : 4,
      energy: recent ? 2 : 4,
      resting_hr: recent ? 60 + (offset % 2) : 52 + (offset % 2),
      hrv: recent ? 53 + (offset % 3) : 67 + (offset % 3),
      notes: null,
      created_at: iso,
      updated_at: iso,
    });
  }
  return out;
}
