import { describe, it, expect } from "vitest";
import { nextDayIndex } from "@/lib/plans";

// The rotation rule is the one piece of real logic in plans.ts, and getting it
// wrong is invisible: the app would just show the wrong day. It is pure so it
// can be pinned without a database.

describe("nextDayIndex", () => {
  it("starts at the first day when nothing has been logged", () => {
    expect(nextDayIndex([], 4, "2026-07-29")).toBe(0);
  });

  it("advances one day per logged training day", () => {
    expect(nextDayIndex(["2026-07-27"], 4, "2026-07-29")).toBe(1);
    expect(nextDayIndex(["2026-07-26", "2026-07-27"], 4, "2026-07-29")).toBe(2);
  });

  it("wraps around at the end of the rotation", () => {
    const dates = ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27"];
    expect(nextDayIndex(dates, 4, "2026-07-29")).toBe(0);
  });

  // The reason this is session-driven rather than weekday-driven. A lifter who
  // skips a day should resume where they left off, not lose that day forever.
  it("does not skip a day when the athlete misses a week", () => {
    const afterOneSession = nextDayIndex(["2026-07-01"], 4, "2026-07-29");
    expect(afterOneSession).toBe(1);
  });

  // Opening the app mid-workout must not jump to tomorrow's session.
  it("does not advance for a session logged today", () => {
    expect(nextDayIndex(["2026-07-29"], 4, "2026-07-29")).toBe(0);
    expect(nextDayIndex(["2026-07-27", "2026-07-29"], 4, "2026-07-29")).toBe(1);
  });

  it("counts two sessions in one day as one training day", () => {
    expect(nextDayIndex(["2026-07-27", "2026-07-27"], 4, "2026-07-29")).toBe(1);
  });

  it("accepts full timestamps, not just date keys", () => {
    expect(nextDayIndex(["2026-07-27T18:30:00.000Z"], 4, "2026-07-29")).toBe(1);
  });

  it("ignores ordering of the input dates", () => {
    const shuffled = ["2026-07-27", "2026-07-24", "2026-07-26", "2026-07-25"];
    expect(nextDayIndex(shuffled, 4, "2026-07-29")).toBe(0);
  });

  it("returns 0 rather than dividing by zero on a plan with no days", () => {
    expect(nextDayIndex(["2026-07-27"], 0, "2026-07-29")).toBe(0);
  });

  it("stays in range for every rotation length and history size", () => {
    for (let dayCount = 1; dayCount <= 7; dayCount++) {
      for (let logged = 0; logged <= 20; logged++) {
        const dates = Array.from({ length: logged }, (_, i) => `2026-0${1 + (i % 9)}-0${1 + (i % 9)}`);
        const idx = nextDayIndex(dates, dayCount, "2026-12-31");
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(dayCount);
      }
    }
  });
});
