import { describe, it, expect } from "vitest";
import {
  MAX_SCAN_FRAMES,
  captureHintFor,
  evenlySample,
  fieldsNeedingReview,
  readingWeightForDisplay,
  scanToSetRow,
  type ScanReading,
} from "@/lib/scan-mapping";
import { toKg } from "@/lib/units";
import { weightSemantics } from "@/lib/weight-semantics";

const reading = (over: Partial<ScanReading> = {}): ScanReading => ({
  detected: true,
  exercise: "Squat",
  equipment: "barbell",
  total_weight_kg: 100,
  reps: 5,
  confidence: "high",
  note: "20kg bar plus 40kg per side.",
  ...over,
});

describe("scan mapping: a scanned set stores exactly like a manual one", () => {
  it("writes canonical kilograms, whatever the athlete sees", () => {
    // A kg athlete confirming 100 stores 100.
    expect(scanToSetRow({ weight: "100", reps: "5" }, "kg")).toEqual({
      reps: 5,
      weight: 100,
      rpe: null,
    });
    // An lb athlete confirming 225 stores the same kilograms the manual form
    // would store for the same typed number.
    const scanned = scanToSetRow({ weight: "225", reps: "5" }, "lb");
    expect(scanned).toEqual({ reps: 5, weight: toKg(225, "lb"), rpe: null });
    expect(scanned!.weight).toBeCloseTo(102.06, 2);
  });

  it("produces an identical row to the manual log form's shape", () => {
    // What log-form builds for a manual set: reps, canonical kg, rpe.
    const manual = { reps: Number("5"), weight: toKg(Number("100"), "kg"), rpe: null };
    expect(scanToSetRow({ weight: "100", reps: "5" }, "kg")).toEqual(manual);
  });

  it("refuses to build a partial row", () => {
    expect(scanToSetRow({ weight: "", reps: "5" }, "kg")).toBeNull();
    expect(scanToSetRow({ weight: "100", reps: "0" }, "kg")).toBeNull();
    expect(scanToSetRow({ weight: "-5", reps: "5" }, "kg")).toBeNull();
    expect(scanToSetRow({ weight: "abc", reps: "5" }, "kg")).toBeNull();
  });

  it("rounds reps to whole numbers", () => {
    expect(scanToSetRow({ weight: "100", reps: 4.6 }, "kg")?.reps).toBe(5);
  });

  it("reads the bar as TOTAL weight, matching what the manual input states", () => {
    // The scanner's label and the barbell convention must not drift apart.
    expect(weightSemantics("barbell").label).toBe("total bar weight");
  });
});

describe("scan mapping: display conversion", () => {
  it("snaps pounds to the nearest 5 and keeps kilograms exact", () => {
    expect(readingWeightForDisplay(100, "kg")).toBe("100");
    expect(readingWeightForDisplay(102.5, "kg")).toBe("102.5");
    // 100 kg is 220.46 lb, which is really 220 on the bar.
    expect(readingWeightForDisplay(100, "lb")).toBe("220");
  });

  it("returns an empty string when the model read nothing", () => {
    expect(readingWeightForDisplay(null, "kg")).toBe("");
    expect(readingWeightForDisplay(0, "kg")).toBe("");
    expect(readingWeightForDisplay(undefined, "lb")).toBe("");
  });
});

describe("scan mapping: honest uncertainty", () => {
  it("flags nothing when the read is complete and confident", () => {
    expect(fieldsNeedingReview(reading(), "ex-1", 8)).toEqual({
      exercise: false,
      weight: false,
      reps: false,
    });
  });

  it("flags the field the model actually left empty", () => {
    expect(fieldsNeedingReview(reading({ total_weight_kg: null }), "ex-1", 8).weight).toBe(true);
    expect(fieldsNeedingReview(reading({ reps: null }), "ex-1", 8).reps).toBe(true);
  });

  it("flags the lift when the guess did not map onto the library", () => {
    expect(fieldsNeedingReview(reading(), "", 8).exercise).toBe(true);
  });

  it("flags every field when the model reports low confidence", () => {
    expect(fieldsNeedingReview(reading({ confidence: "low" }), "ex-1", 8)).toEqual({
      exercise: true,
      weight: true,
      reps: true,
    });
  });

  it("gives one concrete suggestion per thin read, and none when complete", () => {
    expect(captureHintFor(reading(), 8)).toBeNull();
    expect(captureHintFor(reading({ detected: false }), 8)).toMatch(/frame/i);
    expect(captureHintFor(reading({ total_weight_kg: null }), 8)).toMatch(/closer|light/i);
    expect(captureHintFor(reading({ reps: null }), 8)).toMatch(/side/i);
    // A single photo is not expected to yield reps, so it gets no rep nag.
    expect(captureHintFor(reading({ reps: null }), 1)).toBeNull();
  });
});

describe("evenlySample", () => {
  it("leaves a short list alone", () => {
    expect(evenlySample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("keeps the first and last frame, so the end of the set is never dropped", () => {
    const frames = Array.from({ length: 16 }, (_, i) => i);
    const got = evenlySample(frames, 10);
    expect(got).toHaveLength(10);
    expect(got[0]).toBe(0);
    expect(got[got.length - 1]).toBe(15);
  });

  it("spreads evenly rather than truncating", () => {
    const frames = Array.from({ length: 16 }, (_, i) => i);
    expect(evenlySample(frames, 10)).toEqual([0, 2, 3, 5, 7, 8, 10, 12, 13, 15]);
  });

  it("never returns duplicates when trimming", () => {
    const frames = Array.from({ length: 16 }, (_, i) => i);
    const got = evenlySample(frames, 10);
    expect(new Set(got).size).toBe(got.length);
  });

  it("pins the client buffer and the route to the same cap", () => {
    expect(MAX_SCAN_FRAMES).toBe(10);
  });
});
