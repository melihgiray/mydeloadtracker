import { describe, it, expect } from "vitest";
import { buildSampleSets, buildSampleCheckins } from "@/lib/analytics/sample";
import { detectDeload } from "@/lib/analytics/deload";

const now = new Date("2026-06-08T12:00:00");

describe("sample athlete (powers the public /demo)", () => {
  it("produces a rich training history", () => {
    const sets = buildSampleSets(now);
    expect(sets.length).toBeGreaterThan(200);
    expect(new Set(sets.map((s) => s.muscleGroup)).size).toBeGreaterThanOrEqual(6);
  });

  it("fires the deload recommendation (so the demo shows the alert)", () => {
    const report = detectDeload(buildSampleSets(now), now);
    expect(report.recommended).toBe(true);
    expect(report.triggeredCount).toBeGreaterThanOrEqual(2);
  });

  it("converts to lb cleanly and still fires the deload", () => {
    const lb = buildSampleSets(now, "lb");
    const topSquat = Math.max(
      ...lb.filter((s) => s.exerciseName === "Barbell Back Squat").map((s) => s.weight),
    );
    expect(topSquat).toBeGreaterThan(250); // ~260 lb, unmistakably lb not kg
    expect(topSquat % 5).toBe(0); // clean plate numbers
    expect(detectDeload(lb, now).recommended).toBe(true);
  });

  it("includes recovery check-ins that dip recently", () => {
    const ci = buildSampleCheckins(now);
    expect(ci.length).toBe(28);
    const recent = ci.filter((c) => c.hrv != null).slice(0, 3);
    const older = ci.filter((c) => c.hrv != null).slice(10, 20);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(recent.map((c) => c.hrv!))).toBeLessThan(avg(older.map((c) => c.hrv!)));
  });
});
