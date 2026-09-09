import { describe, expect, it } from "vitest";
import { buildLiveSetAdjustment } from "@/lib/live-set-adjustment";

const target = { repLow: 5, repHigh: 8, rpe: 8 };

describe("buildLiveSetAdjustment", () => {
  it("reduces load after a set that is meaningfully harder than target", () => {
    expect(buildLiveSetAdjustment({ weight: 100, reps: 6, rpe: 9 }, target, "kg")).toEqual({
      direction: "back_off",
      weight: 95,
      reps: 6,
      reason: "That set reached RPE 9. Reduce the load for the next set.",
    });
  });

  it("reduces load and returns to the rep floor after a missed target", () => {
    expect(buildLiveSetAdjustment({ weight: 100, reps: 3, rpe: null }, target, "kg")).toMatchObject({
      direction: "back_off",
      weight: 95,
      reps: 5,
    });
  });

  it("adds one rep when effort is low and the range has room", () => {
    expect(buildLiveSetAdjustment({ weight: 100, reps: 6, rpe: 7 }, target, "kg")).toMatchObject({
      direction: "progress",
      weight: 100,
      reps: 7,
    });
  });

  it("adds the smallest normal load step at the top of the range", () => {
    expect(buildLiveSetAdjustment({ weight: 100, reps: 8, rpe: 7 }, target, "kg")).toMatchObject({
      direction: "progress",
      weight: 102.5,
      reps: 5,
    });
    expect(buildLiveSetAdjustment({ weight: 225, reps: 8, rpe: 7 }, target, "lb")).toMatchObject({
      weight: 230,
    });
  });

  it("reduces reps rather than inventing load changes for bodyweight work", () => {
    expect(buildLiveSetAdjustment({ weight: 0, reps: 8, rpe: 9.5 }, target, "kg")).toMatchObject({
      direction: "back_off",
      weight: 0,
      reps: 7,
    });
  });

  it("stays quiet when the completed set does not justify a change", () => {
    expect(buildLiveSetAdjustment({ weight: 100, reps: 6, rpe: 8 }, target, "kg")).toBeNull();
    expect(buildLiveSetAdjustment({ weight: 100, reps: 6, rpe: 8.5 }, target, "kg")).toBeNull();
  });

  it("rejects incomplete or invalid completed set data", () => {
    expect(buildLiveSetAdjustment({ weight: 100, reps: 0, rpe: 8 }, target, "kg")).toBeNull();
    expect(buildLiveSetAdjustment({ weight: -1, reps: 5, rpe: 8 }, target, "kg")).toBeNull();
    expect(buildLiveSetAdjustment({ weight: 100, reps: 5, rpe: 11 }, target, "kg")).toBeNull();
  });
});
