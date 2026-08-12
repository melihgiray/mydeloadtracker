// Tests for the estimated-1RM primitive (Brzycki) that every analytic depends
// on, including the reps clamp that guards the 37-rep divide-by-zero.

import { describe, it, expect } from "vitest";
import { estimate1RM, round1 } from "@/lib/analytics/epley";

describe("estimate1RM (Brzycki)", () => {
  it("returns the weight itself for a single rep", () => {
    expect(estimate1RM(100, 1)).toBe(100);
  });

  it("matches the Brzycki formula for multi-rep sets", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(112.5, 3); // 100 * 36 / 32
    expect(estimate1RM(110, 3)).toBeCloseTo(116.47, 2); // 110 * 36 / 34
  });

  it("returns 0 for non-positive weight or reps", () => {
    expect(estimate1RM(0, 5)).toBe(0);
    expect(estimate1RM(100, 0)).toBe(0);
    expect(estimate1RM(-50, 5)).toBe(0);
  });

  it("clamps reps to 36 so the 37-rep singularity can never divide by zero", () => {
    expect(estimate1RM(100, 36)).toBe(3600); // 100 * 36 / 1
    expect(Number.isFinite(estimate1RM(100, 37))).toBe(true);
    expect(estimate1RM(100, 100)).toBe(3600); // clamped to 36, not Infinity/NaN
  });
});

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(118.125)).toBe(118.1);
    expect(round1(116.4705)).toBe(116.5);
  });
});
