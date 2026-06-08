// Training Readiness model — a graded (0-100) fatigue score that layers on top
// of the binary deload trigger in deload.ts.
//
// WHY A HEURISTIC (AND NOT ML YET): with no labeled outcome data, a transparent
// weighted-factor model is the right call — it's explainable (we can tell the
// athlete *exactly* why) and tunable. It is deliberately structured as a single
// `computeReadiness(features)` step so it can later be swapped for / blended with
// a learned model once we collect outcome labels (did performance rebound after
// a deload?). See docs/DELOAD_SCIENCE.md for the evidence base and ML roadmap.
//
// AGGREGATION: each factor produces a `strength` in 0..1 (its max influence ×
// how elevated the raw marker is). We combine them with a noisy-OR —
//   fatigue = 1 − Π(1 − strengthᵢ)
// so any two or three elevated markers compound into high fatigue, rather than a
// fixed-weight average where one absent marker caps the score. This keeps the
// gauge consistent with the 2-of-3 binary deload trigger.

import type { DailyCheckin, TrainingSet } from "@/lib/types";
import { weeklyPointsForExercise } from "./progress";
import { recentWeekKeys, weekKey } from "./dates";
import { estimate1RM, round1 } from "./epley";
import {
  cadenceFor,
  overallStrength,
  STANDARD_LIFTS,
  type DeloadCadence,
  type Sex,
} from "./standards";

export type Tone = "good" | "caution" | "bad";

export interface ReadinessFactor {
  id: string;
  label: string;
  /** This factor's maximum influence on fatigue (0..1). */
  maxStrength: number;
  /** 0..1, how elevated the raw marker is (1 = max fatigue/risk). */
  value: number;
  /** maxStrength × value — used in the noisy-OR aggregation. */
  strength: number;
  detail: string;
}

export interface ReadinessBand {
  id: "fresh" | "solid" | "caution" | "deload";
  label: string;
  tone: Tone;
}

export interface ReadinessReport {
  score: number; // 0..100, higher = fresher
  band: ReadinessBand;
  factors: ReadinessFactor[];
  /** The 1-3 factors dragging readiness down the most, as sentences. */
  topDrivers: string[];
  /** Experience level used to scale deload cadence (null if bodyweight/sex unset). */
  experienceLabel: string | null;
  /** Plain-language deload cadence guidance for the athlete's level. */
  cadenceNote: string;
}

export interface ReadinessOptions {
  /** Athlete bodyweight in their logging unit (kg or lb); enables experience tuning. */
  bodyweight?: number | null;
  sex?: Sex | null;
}

const WINDOW_WEEKS = 6;

/** Piecewise-linear map: value `x` between (x0->0) and (x1->1), clamped. */
function ramp(x: number, x0: number, x1: number): number {
  if (x1 === x0) return x <= x0 ? 0 : 1;
  return Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
}

function factor(
  id: string,
  label: string,
  maxStrength: number,
  value: number,
  detail: string,
): ReadinessFactor {
  return { id, label, maxStrength, value, strength: maxStrength * value, detail };
}

interface MajorSeries {
  name: string;
  points: ReturnType<typeof weeklyPointsForExercise>;
}

function majorSeries(sets: TrainingSet[], now: Date): MajorSeries[] {
  const byEx = new Map<string, { name: string; sets: TrainingSet[] }>();
  for (const s of sets) {
    if (!s.isMajor) continue;
    const e = byEx.get(s.exerciseId) ?? { name: s.exerciseName, sets: [] };
    e.sets.push(s);
    byEx.set(s.exerciseId, e);
  }
  return [...byEx.values()].map((e) => ({
    name: e.name,
    points: weeklyPointsForExercise(e.sets, WINDOW_WEEKS, now),
  }));
}

/** Weekly total volume (weight*reps) over the window, oldest -> newest. */
function weeklyVolume(sets: TrainingSet[], now: Date): number[] {
  const keys = recentWeekKeys(WINDOW_WEEKS, now);
  const vol = new Map(keys.map((k) => [k, 0]));
  for (const s of sets) {
    const k = weekKey(s.date);
    if (vol.has(k)) vol.set(k, vol.get(k)! + s.weight * s.reps);
  }
  return keys.map((k) => vol.get(k)!);
}

// --- Individual factors -----------------------------------------------------
// Each `maxStrength` (k) reflects how strongly the evidence ties the marker to
// accumulated fatigue. They are NOT required to sum to 1 (noisy-OR aggregation).

// (1) Estimated-1RM regression on major lifts. An e1RM drop of >=5% from a
// recent peak is the clearest single marker of accumulated fatigue.
function factorRegression(majors: MajorSeries[]): ReadinessFactor {
  let worstDrop = 0;
  let worstName = "";
  for (const m of majors) {
    const active = m.points.filter((p) => p.bestE1RM > 0);
    if (active.length < 2) continue;
    const peak = Math.max(...active.map((p) => p.bestE1RM));
    const current = active[active.length - 1].bestE1RM;
    const dropPct = peak > 0 ? ((peak - current) / peak) * 100 : 0;
    if (dropPct > worstDrop) {
      worstDrop = dropPct;
      worstName = m.name;
    }
  }
  const value = ramp(worstDrop, 1, 8); // 1% -> 0, 8% -> 1 (5% lands ~0.57)
  return factor(
    "e1rm_regression",
    "Strength regression",
    0.6,
    value,
    worstDrop >= 1
      ? `${worstName} e1RM is down ${round1(worstDrop)}% from its recent peak.`
      : "No major lift has dropped from its peak.",
  );
}

// (2) Major lifts stalled (no e1RM/volume increase) for 3+ weeks.
function factorStall(majors: MajorSeries[]): ReadinessFactor {
  let stalled = 0;
  const names: string[] = [];
  for (const m of majors) {
    const active = m.points.filter((p) => p.bestE1RM > 0 || p.volume > 0);
    if (active.length < 4) continue;
    let lastImp = 0;
    let maxE = active[0].bestE1RM;
    let maxV = active[0].volume;
    for (let i = 1; i < active.length; i++) {
      if (active[i].bestE1RM > maxE || active[i].volume > maxV) lastImp = i;
      maxE = Math.max(maxE, active[i].bestE1RM);
      maxV = Math.max(maxV, active[i].volume);
    }
    if (active.length - 1 - lastImp >= 3) {
      stalled += 1;
      names.push(m.name);
    }
  }
  const value = Math.min(1, stalled / 2); // 2+ stalled majors -> max
  return factor(
    "stalled_majors",
    "Stalled major lifts",
    0.45,
    value,
    stalled
      ? `${stalled} major lift${stalled > 1 ? "s" : ""} stalled 3+ weeks: ${names.join(", ")}.`
      : "Major lifts are still moving up.",
  );
}

// (3) RPE creep at a flat (or lower) working weight.
function factorRpeCreep(sets: TrainingSet[], now: Date): ReadinessFactor {
  const byEx = new Map<string, { name: string; sets: TrainingSet[] }>();
  for (const s of sets) {
    const e = byEx.get(s.exerciseId) ?? { name: s.exerciseName, sets: [] };
    e.sets.push(s);
    byEx.set(s.exerciseId, e);
  }
  let worst = 0;
  let worstName = "";
  for (const { name, sets: exSets } of byEx.values()) {
    const pts = weeklyPointsForExercise(exSets, WINDOW_WEEKS, now).filter(
      (p) => p.sets > 0 && p.avgRpe != null,
    );
    if (pts.length < 2) continue;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (last.topSetWeight > first.topSetWeight) continue; // earned via more load
    const delta = (last.avgRpe ?? 0) - (first.avgRpe ?? 0);
    if (delta > worst) {
      worst = delta;
      worstName = name;
    }
  }
  const value = ramp(worst, 0.75, 2.5); // ~RPE +0.75 -> 0, +2.5 -> 1
  return factor(
    "rpe_creep",
    "Rising effort, flat load",
    0.4,
    value,
    worst >= 0.75
      ? `${worstName} effort is up ${round1(worst)} RPE at the same or lighter weight.`
      : "Effort is steady relative to load.",
  );
}

// (4) Session-frequency drop in the last 2 weeks vs the prior 4-week average.
function factorFrequency(sets: TrainingSet[], now: Date): ReadinessFactor {
  const keys = recentWeekKeys(WINDOW_WEEKS, now);
  const byWeek = new Map(keys.map((k) => [k, new Set<string>()]));
  for (const s of sets) byWeek.get(weekKey(s.date))?.add(s.sessionId);
  const counts = keys.map((k) => byWeek.get(k)!.size);
  const last2 = counts.slice(-2);
  const prior4 = counts.slice(0, WINDOW_WEEKS - 2);
  const last2Avg = last2.reduce((a, b) => a + b, 0) / last2.length;
  const prior4Avg = prior4.reduce((a, b) => a + b, 0) / prior4.length || 0;
  const dropRatio = prior4Avg > 0 ? (prior4Avg - last2Avg) / prior4Avg : 0;
  const value = ramp(dropRatio, 0.1, 0.6); // 10% drop -> 0, 60%+ drop -> 1
  return factor(
    "frequency_drop",
    "Falling frequency",
    0.34,
    value,
    dropRatio > 0.1
      ? `Sessions down to ${round1(last2Avg)}/wk from ${round1(prior4Avg)}/wk.`
      : "Training frequency is holding steady.",
  );
}

// (5) Acute:chronic workload ratio. A spike (acute week >> 6-week average)
// flags a fast volume ramp linked to elevated fatigue/injury risk.
function factorAcwr(sets: TrainingSet[], now: Date): ReadinessFactor {
  const vol = weeklyVolume(sets, now);
  const acute = vol[vol.length - 1];
  const chronic = vol.reduce((a, b) => a + b, 0) / vol.length || 0;
  const acwr = chronic > 0 ? acute / chronic : 0;
  const value = ramp(acwr, 1.3, 2.0); // >1.3 starts to count, >=2.0 maxes out
  return factor(
    "acwr_spike",
    "Workload spike",
    0.28,
    value,
    acwr >= 1.3
      ? `This week's volume is ${round1(acwr)}x your 6-week average (rapid ramp).`
      : "Workload is ramping at a sustainable rate.",
  );
}

// (6) Time under load — consecutive recent hard weeks without a lighter week.
// How long an athlete can stack hard weeks before fatigue warrants a deload
// scales with experience (see standards.ts): novices get a long runway, elites
// a short one. The `cadence` ramp encodes that — e.g. intermediate 5->9 weeks,
// advanced 4->7, novice 7->12.
function factorTimeUnderLoad(
  sets: TrainingSet[],
  now: Date,
  cadence: DeloadCadence,
): ReadinessFactor {
  const vol = weeklyVolume(sets, now);
  const peak = Math.max(...vol, 0);
  let streak = 0;
  for (let i = vol.length - 1; i >= 0; i--) {
    if (vol[i] > 0 && vol[i] >= 0.6 * peak) streak += 1;
    else break;
  }
  const value = ramp(streak, cadence.lowWeeks, cadence.highWeeks);
  return factor(
    "time_under_load",
    "Weeks of hard training",
    0.22,
    value,
    streak >= cadence.lowWeeks
      ? `${streak} consecutive hard weeks logged without a lighter week (${cadence.note}).`
      : `${streak} consecutive hard week${streak === 1 ? "" : "s"} — plenty of runway (${cadence.note}).`,
  );
}

/** Best estimated 1RM per standard lift, keyed by exercise name (for banding). */
function bestE1RMByStandardLift(sets: TrainingSet[]): Map<string, number> {
  const names = new Set<string>(STANDARD_LIFTS);
  const best = new Map<string, number>();
  for (const s of sets) {
    if (!names.has(s.exerciseName)) continue;
    const e = estimate1RM(s.weight, s.reps);
    if (e > (best.get(s.exerciseName) ?? 0)) best.set(s.exerciseName, e);
  }
  return best;
}

// (7) Subjective wellness from daily check-ins (last 7 days). Poor sleep, high
// soreness, and low motivation/energy are well-supported under-recovery markers.
// Contributes nothing when the athlete hasn't logged any check-ins.
function factorWellness(checkins: DailyCheckin[], now: Date): ReadinessFactor {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const recent = checkins.filter((c) => new Date(c.date) >= cutoff);

  // higher value of `lowerIsWorse` metrics (sleep/motivation/energy) is good;
  // soreness is the reverse. Map each 1-5 metric to a 0..1 fatigue score where
  // 4-5 = fine, 3 = mild, 1-2 = bad.
  const goodHigh = (v: number) => Math.max(0, Math.min(1, (4 - v) / 3));
  const goodLow = (v: number) => Math.max(0, Math.min(1, (v - 2) / 3));

  const dayScores: number[] = [];
  const sums = { sleep: 0, sleepN: 0, sore: 0, soreN: 0, mot: 0, motN: 0, en: 0, enN: 0 };
  for (const c of recent) {
    const fs: number[] = [];
    if (c.sleep_quality != null) {
      fs.push(goodHigh(c.sleep_quality));
      sums.sleep += c.sleep_quality;
      sums.sleepN++;
    }
    if (c.soreness != null) {
      fs.push(goodLow(c.soreness));
      sums.sore += c.soreness;
      sums.soreN++;
    }
    if (c.motivation != null) {
      fs.push(goodHigh(c.motivation));
      sums.mot += c.motivation;
      sums.motN++;
    }
    if (c.energy != null) {
      fs.push(goodHigh(c.energy));
      sums.en += c.energy;
      sums.enN++;
    }
    if (fs.length) dayScores.push(fs.reduce((a, b) => a + b, 0) / fs.length);
  }

  const value = dayScores.length
    ? dayScores.reduce((a, b) => a + b, 0) / dayScores.length
    : 0;

  let detail = "No recent check-ins logged.";
  if (dayScores.length) {
    const parts: string[] = [];
    if (sums.sleepN) parts.push(`sleep ${round1(sums.sleep / sums.sleepN)}`);
    if (sums.soreN) parts.push(`soreness ${round1(sums.sore / sums.soreN)}`);
    if (sums.motN) parts.push(`motivation ${round1(sums.mot / sums.motN)}`);
    if (sums.enN) parts.push(`energy ${round1(sums.en / sums.enN)}`);
    detail =
      value > 0.15
        ? `Subjective recovery is low (${parts.join(", ")} avg over ${dayScores.length}d).`
        : `Subjective recovery is good (${parts.join(", ")} avg over ${dayScores.length}d).`;
  }

  return factor("wellness", "Subjective recovery", 0.4, value, detail);
}

// Split a metric's daily readings into a recent average (last ~4 days) and a
// personal baseline (readings 7+ days ago, within the window). Returns nulls
// when there isn't enough data to be meaningful.
function splitRecentBaseline(
  readings: { date: string; v: number | null }[],
  now: Date,
): { recent: number | null; baseline: number | null } {
  const recentCut = new Date(now);
  recentCut.setDate(recentCut.getDate() - 4);
  const baseEnd = new Date(now);
  baseEnd.setDate(baseEnd.getDate() - 7);
  const recentVals: number[] = [];
  const baseVals: number[] = [];
  for (const r of readings) {
    if (r.v == null) continue;
    const d = new Date(r.date + "T00:00:00");
    if (d >= recentCut) recentVals.push(r.v);
    else if (d <= baseEnd) baseVals.push(r.v);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    recent: recentVals.length >= 2 ? mean(recentVals) : null,
    baseline: baseVals.length >= 3 ? median(baseVals) : null,
  };
}

// (8) Resting heart-rate elevation vs the athlete's own baseline. A sustained
// rise in morning RHR is a classic autonomic under-recovery marker.
function factorRestingHr(checkins: DailyCheckin[], now: Date): ReadinessFactor {
  const { recent, baseline } = splitRecentBaseline(
    checkins.map((c) => ({ date: c.date, v: c.resting_hr })),
    now,
  );
  if (recent == null || baseline == null) {
    return factor("rhr_elevation", "Resting HR vs baseline", 0.35, 0, "No resting-HR data yet.");
  }
  const delta = recent - baseline;
  const value = ramp(delta, 3, 10); // +3 bpm starts to count, +10 maxes out
  return factor(
    "rhr_elevation",
    "Resting HR vs baseline",
    0.35,
    value,
    delta >= 3
      ? `Resting HR is ${round1(delta)} bpm above baseline (${round1(baseline)} → ${round1(recent)} bpm).`
      : `Resting HR is steady vs baseline (~${round1(recent)} bpm).`,
  );
}

// (9) HRV depression vs baseline. A drop in HRV (e.g. RMSSD) is among the most
// supported objective markers of accumulated fatigue / sympathetic dominance.
function factorHrv(checkins: DailyCheckin[], now: Date): ReadinessFactor {
  const { recent, baseline } = splitRecentBaseline(
    checkins.map((c) => ({ date: c.date, v: c.hrv })),
    now,
  );
  if (recent == null || baseline == null || baseline <= 0) {
    return factor("hrv_depression", "HRV vs baseline", 0.45, 0, "No HRV data yet.");
  }
  const dropPct = ((baseline - recent) / baseline) * 100;
  const value = ramp(dropPct, 5, 25); // 5% below baseline starts, 25% maxes out
  return factor(
    "hrv_depression",
    "HRV vs baseline",
    0.45,
    value,
    dropPct >= 5
      ? `HRV is down ${round1(dropPct)}% vs baseline (${round1(baseline)} → ${round1(recent)} ms).`
      : `HRV is holding near baseline (~${round1(recent)} ms).`,
  );
}

const BANDS: ReadinessBand[] = [
  { id: "fresh", label: "Fresh — primed to push", tone: "good" },
  { id: "solid", label: "Solid — keep progressing", tone: "good" },
  { id: "caution", label: "Caution — monitor fatigue", tone: "caution" },
  { id: "deload", label: "Deload recommended", tone: "bad" },
];

function bandFor(score: number): ReadinessBand {
  if (score >= 75) return BANDS[0];
  if (score >= 55) return BANDS[1];
  if (score >= 40) return BANDS[2];
  return BANDS[3];
}

export function computeReadiness(
  sets: TrainingSet[],
  checkins: DailyCheckin[] = [],
  now: Date = new Date(),
  opts: ReadinessOptions = {},
): ReadinessReport {
  // Experience level (from bodyweight-relative strength) scales how long the
  // athlete can stack hard weeks before time-under-load fatigue counts. Unknown
  // bodyweight/sex => intermediate defaults, so behavior is unchanged for users
  // who haven't entered their stats.
  const overall = overallStrength(
    bestE1RMByStandardLift(sets),
    opts.bodyweight,
    opts.sex,
  );
  const cadence: DeloadCadence = cadenceFor(overall?.level.id);

  const majors = majorSeries(sets, now);
  const factors: ReadinessFactor[] = [
    factorRegression(majors),
    factorStall(majors),
    factorRpeCreep(sets, now),
    factorWellness(checkins, now),
    factorHrv(checkins, now),
    factorRestingHr(checkins, now),
    factorFrequency(sets, now),
    factorAcwr(sets, now),
    factorTimeUnderLoad(sets, now, cadence),
  ];

  // Noisy-OR: independent risk factors compound rather than average out.
  const intact = factors.reduce((acc, f) => acc * (1 - f.strength), 1);
  const fatigue = 1 - intact;
  const score = Math.round(Math.max(0, Math.min(100, 100 * (1 - fatigue))));
  const band = bandFor(score);

  const topDrivers = [...factors]
    .filter((f) => f.value > 0.15)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map((f) => f.detail);

  return {
    score,
    band,
    factors,
    topDrivers,
    experienceLabel: overall?.level.label ?? null,
    cadenceNote: cadence.note,
  };
}
