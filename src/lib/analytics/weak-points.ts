// Which muscle groups are lagging, and why.
//
// The planner used to receive strength levels for `isMajor` lifts only, which
// is four exercises: squat, bench, deadlift, overhead press. So it knew how
// strong an athlete's squat was and nothing at all about their arms, and the
// athlete had to type "my arms are lagging" into a free-text box that the model
// might or might not act on. The app already had every number needed to work
// that out; it just never did.
//
// This module reads them. 64 lifts in the library have published standards,
// covering 11 of the 13 muscle groups including 5 biceps and 4 triceps lifts.
//
// THE COMPARISON IS TO THE ATHLETE, NOT TO A POPULATION.
//
// "Lagging" only means anything relative to the rest of the same body. An
// Intermediate squat next to a Novice curl is a lagging arm; an Intermediate
// curl next to an Intermediate squat is not, even though both are Intermediate.
// So every muscle is scored against what the athlete's STRONGER muscles can
// do, not against a population table. This also makes the signal work for a
// beginner and an advanced lifter without either being told they are behind.
//
// Two dimensions, deliberately kept separate:
//   STRENGTH, from the strengthlevel tables via standards.ts.
//   VOLUME, from setVolume.ts against the researched landmarks.
// A muscle can lag on either. Being weak while training a muscle hard is a
// different problem from being weak because it is barely trained, and the
// planner needs to tell them apart to do anything useful.
//
// Pure. No database, no network.

import type { PersonalRecord } from "./records";
import type { SetVolumeReport } from "./setVolume";
import { classifyLift, type Sex } from "./standards";
import { MUSCLE_GROUPS, canValidate, prescriptionRange, zoneFor, type VolumeZone } from "./volume-landmarks";
import type { Units } from "@/lib/types";

/**
 * How far below the athlete's stronger muscles a muscle must sit to be called
 * lagging, in strength levels.
 *
 * Half a level. Small enough to catch a real imbalance before it becomes
 * visible, large enough that ordinary noise between two lifts does not
 * relabel a muscle every time the athlete has a good session. This is a
 * judgement, not a measured threshold, and it is the one number here worth
 * revisiting against real user data.
 */
export const LAG_THRESHOLD = 0.5;

/** Above the reference by this much and a muscle is carrying the athlete. */
export const LEAD_THRESHOLD = 0.5;

export type MuscleStatus = "lagging" | "on_track" | "leading" | "unscored";

export interface MuscleAssessment {
  muscle: string;
  /**
   * Continuous strength position, 0 (Beginner) to 4 (Elite), carrying the
   * fractional progress toward the next level. Null when no lift for this
   * muscle has a published standard, which is true of Calves and Forearms.
   */
  strengthScore: number | null;
  strengthLabel: string | null;
  /** The lift the score came from, so the athlete can check the reasoning. */
  basedOn: string | null;
  liftsScored: number;
  setsPerWeek: number;
  volumeZone: VolumeZone | null;
  /** Levels below the athlete's stronger muscles. Positive means behind. */
  lag: number | null;
  status: MuscleStatus;
  /** Plain sentences explaining the status, safe to show or to prompt with. */
  reasons: string[];
}

export interface WeakPointReport {
  /** Every muscle, strongest first, with unscored muscles last. */
  muscles: MuscleAssessment[];
  /** The athlete's median strength score across scored muscles. */
  medianScore: number | null;
  /**
   * The benchmark muscles are actually judged against: the median of the
   * STRONGER half. See the note on referenceScore below for why the plain
   * median is the wrong yardstick.
   */
  referenceScore: number | null;
  /** Muscles behind the reference, worst first. Empty when nothing is behind. */
  lagging: MuscleAssessment[];
  /** Muscles below their minimum effective volume, regardless of strength. */
  underTrained: MuscleAssessment[];
  /**
   * True when there was not enough classified history to compare anything, so
   * callers can say "not enough data yet" instead of implying balance.
   */
  insufficientData: boolean;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Score every muscle group on strength and volume, then rank them against each
 * other.
 *
 * `records` is every lift the athlete has logged. Only those with a published
 * standard contribute a strength score; the rest still contribute volume.
 */
export function assessWeakPoints(
  records: PersonalRecord[],
  volume: SetVolumeReport,
  opts: { bodyweight: number | null; sex: Sex | null; units: Units },
): WeakPointReport {
  const setsByMuscle = new Map(volume.muscles.map((m) => [m.muscleGroup, m.setsPerWeek]));

  // Best classified lift per muscle. Best rather than average, because a low
  // score on one variation usually means it is untrained or technically new,
  // while the best lift is the closest thing to actual capability.
  const best = new Map<string, { score: number; label: string; lift: string; count: number }>();
  if (opts.bodyweight && opts.sex) {
    for (const record of records) {
      const standard = classifyLift(
        record.exerciseName,
        { e1rm: record.bestE1RM, reps: record.bestReps },
        opts.bodyweight,
        opts.sex,
        opts.units,
      );
      if (!standard) continue;
      // rank plus fractional progress: an Intermediate most of the way to
      // Advanced should not tie with one who just arrived.
      const score = standard.level.rank + Math.min(1, Math.max(0, standard.progressToNext));
      const current = best.get(record.muscleGroup);
      const count = (current?.count ?? 0) + 1;
      if (!current || score > current.score) {
        best.set(record.muscleGroup, {
          score,
          label: standard.level.label,
          lift: record.exerciseName,
          count,
        });
      } else {
        best.set(record.muscleGroup, { ...current, count });
      }
    }
  }

  const scores = [...best.values()].map((b) => b.score);
  const medianScore = median(scores);

  /**
   * Judge against the stronger half, not the overall median.
   *
   * A plain median is diluted by the very muscles it is meant to catch. On real
   * data: shoulders 2.57 and back 2.29 against biceps 1.18 and triceps 1.10
   * gave a median of 1.59, which put both arms 0.41 and 0.49 behind, just under
   * a 0.5 threshold, and reported nothing lagging. The weak muscles had pulled
   * the yardstick down to meet themselves.
   *
   * Taking the median of the scores at or above the overall median gives 2.29
   * here, and the same arms come out 1.11 and 1.19 behind, which matches what
   * the athlete already knew. The question is "behind what this body can do",
   * and the stronger half is the better answer to that.
   */
  const upperHalf = medianScore == null ? [] : scores.filter((v) => v >= medianScore);
  const referenceScore = median(upperHalf);

  const muscles: MuscleAssessment[] = MUSCLE_GROUPS.map((muscle) => {
    const b = best.get(muscle);
    const setsPerWeek = setsByMuscle.get(muscle) ?? 0;
    const volumeZone = zoneFor(muscle, setsPerWeek);
    const lag = b != null && referenceScore != null ? round2(referenceScore - b.score) : null;

    let status: MuscleStatus = "unscored";
    if (lag != null) {
      if (lag >= LAG_THRESHOLD) status = "lagging";
      else if (lag <= -LEAD_THRESHOLD) status = "leading";
      else status = "on_track";
    }

    const reasons: string[] = [];
    if (b && lag != null && status === "lagging") {
      reasons.push(
        `${b.label} on ${b.lift}, about ${Math.abs(lag).toFixed(1)} levels behind the rest of your lifts.`,
      );
    } else if (b && status === "leading") {
      reasons.push(`${b.label} on ${b.lift}, ahead of your other muscle groups.`);
    } else if (b) {
      reasons.push(`${b.label} on ${b.lift}, in line with your other muscle groups.`);
    }

    // Volume is a separate reason, because being weak while training hard and
    // being weak because you barely train it need different prescriptions.
    const range = canValidate(muscle) ? prescriptionRange(muscle) : null;
    if (range) {
      if (setsPerWeek < range.min) {
        reasons.push(
          `${setsPerWeek} direct sets per week, under the ${range.min} set starting point.`,
        );
      } else if (setsPerWeek > range.max) {
        reasons.push(`${setsPerWeek} direct sets per week, above the ${range.max} set guide.`);
      }
    } else if (setsPerWeek === 0) {
      reasons.push("No direct sets logged.");
    }

    return {
      muscle,
      strengthScore: b ? round2(b.score) : null,
      strengthLabel: b?.label ?? null,
      basedOn: b?.lift ?? null,
      liftsScored: b?.count ?? 0,
      setsPerWeek,
      volumeZone,
      lag,
      status,
      reasons,
    };
  });

  const ranked = [...muscles].sort((a, b) => {
    if (a.strengthScore == null && b.strengthScore == null) return 0;
    if (a.strengthScore == null) return 1;
    if (b.strengthScore == null) return -1;
    return b.strengthScore - a.strengthScore;
  });

  const lagging = muscles
    .filter((m) => m.status === "lagging")
    .sort((a, b) => (b.lag ?? 0) - (a.lag ?? 0));

  const underTrained = muscles.filter((m) => {
    const range = canValidate(m.muscle) ? prescriptionRange(m.muscle) : null;
    return range != null && m.setsPerWeek < range.min;
  });

  return {
    muscles: ranked,
    medianScore: medianScore != null ? round2(medianScore) : null,
    referenceScore: referenceScore != null ? round2(referenceScore) : null,
    lagging,
    underTrained,
    // Two scored muscles is the minimum that makes a median mean anything.
    insufficientData: best.size < 2,
  };
}

/**
 * The muscles whose direct work should be trained first in a session.
 *
 * Exercise order matters most for whatever is trained while least fatigued,
 * and this is the founder's own diagnosis of why their arms lag: every session
 * put compounds first and arms last, so arms always got the tired end of the
 * session. A lagging muscle that is also under-trained is the strongest case.
 *
 * Capped, because "prioritise everything" is the same as prioritising nothing
 * and a session has a finite front.
 */
export function priorityMuscles(report: WeakPointReport, max = 2): string[] {
  if (report.insufficientData) return [];

  const scorable = report.muscles.filter((m) => canValidate(m.muscle));
  // When nearly everything is under its minimum, under-training says nothing
  // about which muscle to put first. That happens whenever training history is
  // older than the volume window, and it used to hand every muscle the same
  // score, so the ranking fell back to list order and returned whichever groups
  // happened to be first. Strength lag is the signal in that case.
  const volumeDiscriminates =
    scorable.length > 0 && report.underTrained.length < scorable.length;

  const scored = new Map<string, number>();
  // Strength lag dominates: it is measured against the athlete's own lifts and
  // is what "lagging" actually means. Volume is a tiebreak, not a peer.
  for (const m of report.lagging) scored.set(m.muscle, (m.lag ?? 0) * 2);
  if (volumeDiscriminates) {
    for (const m of report.underTrained) {
      scored.set(m.muscle, (scored.get(m.muscle) ?? 0) + 1);
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([muscle]) => muscle);
}
