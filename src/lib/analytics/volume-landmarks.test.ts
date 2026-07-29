import { describe, it, expect } from "vitest";
import {
  EVIDENCE_CAVEAT,
  MUSCLE_GROUPS,
  POPULATION_PRODUCTIVE_RANGE,
  canValidate,
  landmarksFor,
  prescriptionRange,
  zoneFor,
} from "@/lib/analytics/volume-landmarks";

// These tests pin conventions, not the numbers themselves. The numbers live in
// volume-landmarks.json and are allowed to change when better evidence turns
// up. What must not change is that the module never invents one.

describe("MUSCLE_GROUPS", () => {
  it("covers the 13 groups the exercise library uses", () => {
    expect(MUSCLE_GROUPS).toHaveLength(13);
    for (const m of ["Back", "Quads", "Chest", "Shoulders", "Core", "Adductors"]) {
      expect(MUSCLE_GROUPS).toContain(m);
    }
  });

  it("is ordered by library depth, so the planner sees the best-covered first", () => {
    expect(MUSCLE_GROUPS[0]).toBe("Back");
    expect(MUSCLE_GROUPS[MUSCLE_GROUPS.length - 1]).toBe("Adductors");
  });
});

describe("landmarksFor", () => {
  it("returns null for a name that is not one of ours, rather than a default", () => {
    expect(landmarksFor("Lats")).toBeNull();
    expect(landmarksFor("")).toBeNull();
  });

  it("reads a well-covered muscle with its ranges intact", () => {
    const back = landmarksFor("Back");
    expect(back?.mev?.min).toBeGreaterThan(0);
    expect(back?.mav?.max).toBeGreaterThan(back!.mav!.min);
    expect(back?.libraryDepth).toBe(26);
  });

  it("carries the evidence grade out to the caller on every muscle", () => {
    for (const m of MUSCLE_GROUPS) {
      const l = landmarksFor(m);
      expect(["practitioner_consensus", "no_source"]).toContain(l!.evidenceGrade);
    }
  });

  // The whole point of the module. A muscle with no literature must come back
  // empty rather than carrying a plausible-looking number.
  it("returns null landmarks for a muscle with no source, never a guess", () => {
    for (const m of MUSCLE_GROUPS) {
      const l = landmarksFor(m)!;
      if (l.evidenceGrade !== "no_source") continue;
      expect(l.mev).toBeNull();
      expect(l.mav).toBeNull();
      expect(l.mrv).toBeNull();
      expect(l.maintenance).toBeNull();
    }
  });

  it("marks a point value as single rather than faking a range", () => {
    const back = landmarksFor("Back")!;
    expect(back.mev!.singleValue).toBe(true);
    expect(back.mev!.min).toBe(back.mev!.max);
    expect(back.mav!.singleValue).toBe(false);
  });

  it("never reports better than low confidence for a per-muscle number", () => {
    for (const m of MUSCLE_GROUPS) expect(landmarksFor(m)!.confidence).toBe("low");
  });
});

describe("canValidate", () => {
  it("is true for the muscles the library actually covers", () => {
    for (const m of ["Back", "Quads", "Chest", "Triceps"]) {
      expect(canValidate(m)).toBe(true);
    }
  });

  // One exercise in the library, no adductor literature, and most adductor
  // stimulus comes from squats and lunges that log elsewhere.
  it("is false for Adductors, where a missing-volume flag would be a false positive", () => {
    expect(canValidate("Adductors")).toBe(false);
  });

  it("is false for any muscle with no source", () => {
    for (const m of MUSCLE_GROUPS) {
      if (landmarksFor(m)!.evidenceGrade === "no_source") expect(canValidate(m)).toBe(false);
    }
  });

  it("is false for an unknown muscle", () => {
    expect(canValidate("Neck")).toBe(false);
  });
});

describe("prescriptionRange", () => {
  it("runs from MEV to the top of MAV", () => {
    const back = landmarksFor("Back")!;
    expect(prescriptionRange("Back")).toEqual({
      min: back.mev!.min,
      max: back.mav!.max,
      singleValue: false,
    });
  });

  it("is null where there are no landmarks", () => {
    expect(prescriptionRange("Adductors")).toBeNull();
    expect(prescriptionRange("Neck")).toBeNull();
  });

  it("gives every validatable muscle a usable window", () => {
    for (const m of MUSCLE_GROUPS) {
      if (!canValidate(m)) continue;
      const r = prescriptionRange(m)!;
      expect(r.max).toBeGreaterThan(r.min);
    }
  });
});

describe("zoneFor", () => {
  it("calls zero sets none, not growth", () => {
    // Several muscles have a maintenance and MEV of 0, so without an explicit
    // zero case "no direct work at all" would read as productive.
    expect(zoneFor("Core", 0)).toBe("none");
    expect(zoneFor("Glutes", 0)).toBe("none");
    expect(zoneFor("Back", 0)).toBe("none");
  });

  it("walks Back up through every zone in order", () => {
    const l = landmarksFor("Back")!;
    expect(zoneFor("Back", l.mev!.min - 1)).toBe("maintenance");
    expect(zoneFor("Back", l.mev!.min)).toBe("growth");
    expect(zoneFor("Back", l.mav!.min)).toBe("optimal");
    expect(zoneFor("Back", l.mav!.max)).toBe("optimal");
    expect(zoneFor("Back", l.mav!.max + 1)).toBe("high");
    expect(zoneFor("Back", l.mrv!.max + 1)).toBe("over_mrv");
  });

  it("is null where there are no landmarks, so callers must decide", () => {
    expect(zoneFor("Adductors", 10)).toBeNull();
    expect(zoneFor("Neck", 10)).toBeNull();
  });
});

describe("evidence honesty", () => {
  it("names the population range as the better-evidenced claim", () => {
    expect(POPULATION_PRODUCTIVE_RANGE.confidence).toBe("medium");
    expect(POPULATION_PRODUCTIVE_RANGE.min).toBeLessThan(POPULATION_PRODUCTIVE_RANGE.max);
  });

  it("keeps a caveat for the UI that does not oversell the numbers", () => {
    expect(EVIDENCE_CAVEAT).toMatch(/estimate/i);
    expect(EVIDENCE_CAVEAT).not.toMatch(/[—–]/); // house style: no dashes
    expect(EVIDENCE_CAVEAT).not.toContain("!");
  });
});
