import { describe, it, expect } from "vitest";
import { assessWeakPoints, priorityMuscles, LAG_THRESHOLD } from "@/lib/analytics/weak-points";
import type { PersonalRecord } from "@/lib/analytics/records";
import type { SetVolumeReport } from "@/lib/analytics/setVolume";

// These use real lift names and real bodyweight numbers, because the whole
// point is that the classification comes from the scraped standards file. A
// mocked classifier would prove nothing about whether arms are detectable.

const record = (
  exerciseName: string,
  muscleGroup: string,
  bestE1RM: number,
  over: Partial<PersonalRecord> = {},
): PersonalRecord => ({
  exerciseId: exerciseName,
  exerciseName,
  muscleGroup,
  isMajor: false,
  maxWeight: bestE1RM,
  bestE1RM,
  bestE1RMWeight: bestE1RM,
  bestE1RMReps: 1,
  bestReps: 10,
  achievedAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

const volume = (sets: Record<string, number>): SetVolumeReport => ({
  muscles: Object.entries(sets).map(([muscleGroup, setsPerWeek]) => ({
    muscleGroup,
    setsPerWeek,
    thisWeek: setsPerWeek,
    status: "optimal",
    note: "",
  })),
  rows: [],
  muscleGroups: Object.keys(sets),
  windowWeeks: 4,
});

const opts = { bodyweight: 80, sex: "male" as const, units: "kg" as const };

describe("assessWeakPoints", () => {
  it("says so plainly when there is not enough classified history", () => {
    const report = assessWeakPoints([record("Squat", "Quads", 140)], volume({ Quads: 12 }), opts);
    expect(report.insufficientData).toBe(true);
    expect(report.lagging).toEqual([]);
  });

  it("reports nothing scored when bodyweight or sex is missing", () => {
    const report = assessWeakPoints(
      [record("Squat", "Quads", 140), record("Bench Press", "Chest", 100)],
      volume({ Quads: 12, Chest: 12 }),
      { bodyweight: null, sex: null, units: "kg" },
    );
    expect(report.medianScore).toBeNull();
    expect(report.insufficientData).toBe(true);
  });

  // The founder's actual complaint, as a test. Strong compounds, weak curl.
  it("detects lagging arms from a strong lower body and a weak curl", () => {
    const report = assessWeakPoints(
      [
        record("Squat", "Quads", 180),
        record("Deadlift", "Back", 220),
        record("Bench Press", "Chest", 130),
        record("Barbell Curl", "Biceps", 25),
      ],
      volume({ Quads: 14, Back: 16, Chest: 12, Biceps: 4 }),
      opts,
    );
    expect(report.insufficientData).toBe(false);
    const biceps = report.muscles.find((m) => m.muscle === "Biceps")!;
    expect(biceps.status).toBe("lagging");
    expect(biceps.lag).toBeGreaterThanOrEqual(LAG_THRESHOLD);
    expect(report.lagging.map((m) => m.muscle)).toContain("Biceps");
  });

  it("does not call a muscle lagging just because the athlete is a beginner", () => {
    // Everything weak, but evenly weak. Nothing is behind anything else.
    const report = assessWeakPoints(
      [
        record("Squat", "Quads", 60),
        record("Bench Press", "Chest", 40),
        record("Barbell Curl", "Biceps", 20),
      ],
      volume({ Quads: 10, Chest: 10, Biceps: 10 }),
      opts,
    );
    expect(report.lagging).toEqual([]);
  });

  it("names the lift a score came from, so the reasoning is checkable", () => {
    const report = assessWeakPoints(
      [record("Squat", "Quads", 180), record("Barbell Curl", "Biceps", 25)],
      volume({ Quads: 14, Biceps: 4 }),
      opts,
    );
    const biceps = report.muscles.find((m) => m.muscle === "Biceps")!;
    expect(biceps.basedOn).toBe("Barbell Curl");
    expect(biceps.strengthLabel).toBeTruthy();
    expect(biceps.reasons.join(" ")).toContain("Barbell Curl");
  });

  it("keeps strength and volume as separate reasons", () => {
    const report = assessWeakPoints(
      [record("Squat", "Quads", 180), record("Barbell Curl", "Biceps", 25)],
      volume({ Quads: 14, Biceps: 2 }),
      opts,
    );
    const biceps = report.muscles.find((m) => m.muscle === "Biceps")!;
    // One reason about level, one about sets. Being weak while training hard is
    // a different problem from being weak because you barely train it.
    expect(biceps.reasons.length).toBeGreaterThanOrEqual(2);
    expect(biceps.reasons.join(" ")).toMatch(/direct sets per week/);
  });

  it("scores every muscle group, including ones with no published standard", () => {
    const report = assessWeakPoints(
      [record("Squat", "Quads", 180), record("Bench Press", "Chest", 130)],
      volume({ Quads: 14, Chest: 12, Calves: 0 }),
      opts,
    );
    const calves = report.muscles.find((m) => m.muscle === "Calves")!;
    expect(calves.strengthScore).toBeNull();
    expect(calves.status).toBe("unscored");
    // Golden rule 4: no invented level for a muscle with no standard.
    expect(calves.strengthLabel).toBeNull();
  });

  it("flags a muscle under its minimum effective volume regardless of strength", () => {
    const report = assessWeakPoints(
      [record("Squat", "Quads", 180), record("Bench Press", "Chest", 130)],
      volume({ Quads: 14, Chest: 1 }),
      opts,
    );
    expect(report.underTrained.map((m) => m.muscle)).toContain("Chest");
  });

  it("ranks muscles strongest first and puts unscored ones last", () => {
    const report = assessWeakPoints(
      [
        record("Squat", "Quads", 200),
        record("Bench Press", "Chest", 90),
        record("Barbell Curl", "Biceps", 30),
      ],
      volume({ Quads: 14, Chest: 12, Biceps: 8 }),
      opts,
    );
    const scored = report.muscles.filter((m) => m.strengthScore != null);
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].strengthScore!).toBeGreaterThanOrEqual(scored[i].strengthScore!);
    }
    expect(report.muscles[report.muscles.length - 1].strengthScore).toBeNull();
  });

  it("keeps every reason free of dashes and exclamation points", () => {
    const report = assessWeakPoints(
      [record("Squat", "Quads", 180), record("Barbell Curl", "Biceps", 25)],
      volume({ Quads: 14, Biceps: 2 }),
      opts,
    );
    for (const m of report.muscles) {
      for (const r of m.reasons) {
        expect(r).not.toMatch(/[—–]/);
        expect(r).not.toContain("!");
      }
    }
  });
});

describe("priorityMuscles", () => {
  it("is empty when there is not enough data to rank anything", () => {
    const report = assessWeakPoints([record("Squat", "Quads", 140)], volume({ Quads: 12 }), opts);
    expect(priorityMuscles(report)).toEqual([]);
  });

  // The founder's diagnosis: arms lagged because they were always trained last.
  it("puts a lagging, under-trained muscle at the front", () => {
    const report = assessWeakPoints(
      [
        record("Squat", "Quads", 180),
        record("Deadlift", "Back", 220),
        record("Bench Press", "Chest", 130),
        record("Barbell Curl", "Biceps", 25),
      ],
      volume({ Quads: 14, Back: 16, Chest: 12, Biceps: 3 }),
      opts,
    );
    expect(priorityMuscles(report)[0]).toBe("Biceps");
  });

  it("caps the list, because prioritising everything prioritises nothing", () => {
    const report = assessWeakPoints(
      [
        record("Squat", "Quads", 220),
        record("Deadlift", "Back", 260),
        record("Barbell Curl", "Biceps", 20),
        record("Tricep Pushdown", "Triceps", 15),
        record("Lying Leg Curl", "Hamstrings", 30),
      ],
      volume({ Quads: 16, Back: 16, Biceps: 2, Triceps: 2, Hamstrings: 2 }),
      opts,
    );
    expect(priorityMuscles(report).length).toBeLessThanOrEqual(2);
  });
});

// Both of these are regression tests for bugs found by running the real test
// account's lifts through this module, after the first live plan still buried
// arms at the end of the session.
describe("regressions from the first live run", () => {
  // Bug 1. A plain median is pulled down by the weak muscles it is meant to
  // catch. With this data the median was 1.59, putting both arms 0.41 and 0.49
  // behind, just under the 0.5 threshold, so nothing was reported as lagging.
  it("judges against the stronger half, so weak arms cannot hide the gap", () => {
    const report = assessWeakPoints(
      [
        record("Shoulder Press", "Shoulders", 56),
        record("Deadlift", "Back", 172),
        record("Squat", "Quads", 132),
        record("Bench Press", "Chest", 88),
        record("Barbell Curl", "Biceps", 37),
        record("Tricep Pushdown", "Triceps", 41),
      ],
      volume({ Back: 16, Quads: 12, Chest: 10, Shoulders: 9, Biceps: 4, Triceps: 4 }),
      { bodyweight: 85, sex: "male", units: "kg" },
    );
    expect(report.referenceScore).toBeGreaterThan(report.medianScore!);
    const names = report.lagging.map((m) => m.muscle);
    expect(names).toContain("Biceps");
    expect(names).toContain("Triceps");
  });

  // Bug 2. Training history older than the volume window makes every muscle
  // read as zero sets. That used to give them all the same score, so the
  // ranking fell back to list order and returned the first groups in the list
  // rather than the weak ones.
  it("still picks the weak muscles when every muscle reads zero volume", () => {
    const lifts = [
      record("Shoulder Press", "Shoulders", 56),
      record("Deadlift", "Back", 172),
      record("Squat", "Quads", 132),
      record("Barbell Curl", "Biceps", 37),
      record("Tricep Pushdown", "Triceps", 41),
    ];
    const opts85 = { bodyweight: 85, sex: "male" as const, units: "kg" as const };

    const stale = priorityMuscles(assessWeakPoints(lifts, volume({}), opts85));
    const fresh = priorityMuscles(
      assessWeakPoints(
        lifts,
        volume({ Back: 16, Quads: 12, Shoulders: 9, Biceps: 4, Triceps: 4 }),
        opts85,
      ),
    );

    expect(stale).not.toContain("Back");
    expect(stale.some((m) => m === "Biceps" || m === "Triceps")).toBe(true);
    // The answer must not depend on whether the volume window happened to
    // catch the athlete's history.
    expect(stale).toEqual(fresh);
  });
});
