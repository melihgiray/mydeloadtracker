// Builds the structured training summary that is injected into the AI coach's
// system prompt. The goal is to give the model real numbers to reason from —
// per-lift weekly e1RM trends, the deload analysis, volume, and PRs — rather
// than vague prose.

import type { DailyCheckin, Profile, TrainingSet } from "@/lib/types";
import { buildProgressReport } from "./progress";
import { detectDeload } from "./deload";
import { computeReadiness } from "./readiness";
import { buildVolumeReport } from "./volume";
import { buildSetVolume } from "./setVolume";
import { buildRecords } from "./records";
import { buildNextSessions } from "./progression";
import { overallStrength } from "./standards";
import { weekLabel } from "./dates";

export interface CoachContext {
  /** Compact, model-friendly summary string. */
  summary: string;
  /** The structured deload report, reused by the UI/alerts. */
  hasData: boolean;
}

export function buildCoachContext(
  sets: TrainingSet[],
  profile: Pick<Profile, "full_name" | "units" | "bodyweight" | "sex"> | null,
  checkins: DailyCheckin[] = [],
  now: Date = new Date(),
): CoachContext {
  if (sets.length === 0) {
    return {
      hasData: false,
      summary:
        "The athlete has not logged any training yet. Encourage them to log their first session and explain how progressive-overload tracking will help.",
    };
  }

  const units = profile?.units ?? "kg";
  const name = profile?.full_name ?? "the athlete";

  const progress = buildProgressReport(sets, 8, now);
  const deload = detectDeload(sets, now);
  const readiness = computeReadiness(sets, checkins, now, {
    bodyweight: profile?.bodyweight ?? null,
    sex: profile?.sex ?? null,
  });
  const volume = buildVolumeReport(sets, 8, now);
  const setVolume = buildSetVolume(sets, 4, 8, now);
  const records = buildRecords(sets);

  // Strength standards (StrengthLevel-style) — banding each main lift by
  // bodyweight-relative e1RM, used to right-size deload cadence and advice.
  const e1rmByLift = new Map(records.map((r) => [r.exerciseName, r.bestE1RM]));
  const strength = overallStrength(e1rmByLift, profile?.bodyweight ?? null, profile?.sex ?? null);

  const lines: string[] = [];
  lines.push(`ATHLETE: ${name} (weights in ${units})`);
  lines.push(`DATA WINDOW: last 8 weeks, ${sets.length} sets logged.`);
  lines.push("");

  // Deload analysis
  lines.push("DELOAD ANALYSIS:");
  lines.push(
    `  Recommendation: ${deload.recommended ? "DELOAD RECOMMENDED" : "no deload needed"} (${deload.triggeredCount}/3 signals).`,
  );
  for (const sig of deload.signals) {
    lines.push(`  - [${sig.triggered ? "x" : " "}] ${sig.label}: ${sig.detail}`);
  }
  lines.push("");

  // Graded readiness model (0-100, higher = fresher)
  lines.push(`TRAINING READINESS: ${readiness.score}/100, ${readiness.band.label}.`);
  if (readiness.topDrivers.length) {
    lines.push("  Top fatigue drivers:");
    for (const d of readiness.topDrivers) lines.push(`    - ${d}`);
  }
  lines.push("");

  // Strength standards & experience level (drives deload cadence)
  if (strength) {
    lines.push(
      `STRENGTH LEVEL (bodyweight ${profile?.bodyweight} ${units}, ${profile?.sex}): overall ${strength.level.label}.`,
    );
    lines.push(`  Deload cadence for this level: ${readiness.cadenceNote}.`);
    for (const s of strength.perLift) {
      const next = s.nextLevel
        ? ` (→ ${s.nextLevel.label} at ~${s.nextLevelE1RM} ${units})`
        : " (top band)";
      lines.push(`  - ${s.lift}: ${s.level.label} @ ${s.ratio}x bodyweight${next}`);
    }
  } else {
    lines.push(
      "STRENGTH LEVEL: not available, athlete has not set bodyweight/sex, so deload cadence uses intermediate defaults.",
    );
  }
  lines.push("");

  // Recent subjective check-ins (sleep/soreness/motivation/energy, 1-5)
  if (checkins.length) {
    lines.push("RECENT DAILY CHECK-INS (1-5; soreness higher = worse; RHR bpm, HRV ms):");
    for (const c of checkins.slice(0, 7)) {
      const bits = [
        c.sleep_quality != null ? `sleep ${c.sleep_quality}` : null,
        c.soreness != null ? `soreness ${c.soreness}` : null,
        c.motivation != null ? `motivation ${c.motivation}` : null,
        c.energy != null ? `energy ${c.energy}` : null,
        c.resting_hr != null ? `RHR ${c.resting_hr}` : null,
        c.hrv != null ? `HRV ${c.hrv}` : null,
      ].filter(Boolean);
      lines.push(`  ${c.date}: ${bits.join(", ")}`);
    }
    lines.push("");
  }

  // Auto-progression targets (the app's rule-based suggestion; refine, don't replace)
  const nextSessions = buildNextSessions(sets, { units, deload: deload.recommended });
  const majorNext = nextSessions.filter((n) => n.isMajor);
  if (majorNext.length) {
    lines.push("SUGGESTED NEXT SESSIONS (auto-progression, refine these):");
    for (const n of majorNext) {
      lines.push(
        `  ${n.exerciseName}: last ${n.last.weight}${units}x${n.last.reps}${n.last.rpe != null ? ` @RPE${n.last.rpe}` : ""} -> ${n.action.toUpperCase()} ${n.target.weight}${units}x${n.target.reps}x${n.target.sets}`,
      );
    }
    lines.push("");
  }

  // Per-lift progress with weekly e1RM trend
  lines.push("PER-LIFT TREND (best estimated 1RM by week, oldest -> newest):");
  for (const p of progress) {
    const series = p.weeks
      .map((w) => (w.bestE1RM > 0 ? `${weekLabel(w.week)}:${w.bestE1RM}` : `${weekLabel(w.week)}:-`))
      .join("  ");
    const tag = p.isMajor ? " *MAJOR*" : "";
    lines.push(
      `  ${p.exerciseName}${tag} [${p.status}, ${p.e1rmChangePct > 0 ? "+" : ""}${p.e1rmChangePct}%]`,
    );
    lines.push(`      e1RM/wk: ${series}`);
  }
  lines.push("");

  // Weekly volume per muscle group (tonnage)
  lines.push("WEEKLY VOLUME LOAD BY MUSCLE GROUP (tonnage = weight x reps):");
  for (const row of volume.rows) {
    const parts = volume.muscleGroups
      .map((mg) => `${mg} ${row[mg]}`)
      .filter((s) => !s.endsWith(" 0"));
    lines.push(`  ${row.label}: total ${row.total}${parts.length ? " | " + parts.join(", ") : ""}`);
  }
  lines.push("");

  // Hard sets per muscle/week — the hypertrophy dose (target ~10-20).
  lines.push("WEEKLY HARD SETS PER MUSCLE (avg last 4 wks; target 10-20 for growth):");
  for (const m of setVolume.muscles) {
    lines.push(`  ${m.muscleGroup}: ${m.setsPerWeek}/wk [${m.status}], ${m.note}.`);
  }
  lines.push("");

  // Personal records
  lines.push("PERSONAL RECORDS (top lifts):");
  for (const r of records.slice(0, 10)) {
    lines.push(
      `  ${r.exerciseName}: best e1RM ${r.bestE1RM} (${r.bestE1RMWeight}x${r.bestE1RMReps}), top single ${r.maxWeight}`,
    );
  }

  return { hasData: true, summary: lines.join("\n") };
}
