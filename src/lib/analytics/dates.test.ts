import { afterEach, describe, expect, it, vi } from "vitest";
import { localDateKey, todayKey } from "@/lib/analytics/dates";

// A date key in this app is a LOCAL calendar day, because that is the day the
// athlete trained on. Check-ins, the plan day rotation, the weekly review
// window and every analytics window are all keyed that way.
//
// `new Date().toISOString().slice(0, 10)` is a UTC day and looks identical in
// London in the morning. Two client files used it: the workout date in the Log
// form, and the optional recovery row written during onboarding. West of UTC
// that stamped an evening session with TOMORROW, so a workout and the check-in
// taken beside it landed on different days, and the rotation counted a training
// day that had not happened yet.
//
// These tests exist to make that class of mistake fail loudly rather than being
// invisible to anyone reviewing from a UTC machine.

afterEach(() => {
  vi.useRealTimers();
});

/** 6:30pm on 7 August in Los Angeles, which is already the 8th in UTC. */
const EVENING_IN_THE_AMERICAS = new Date("2026-08-08T01:30:00Z");

describe("date keys are local days, not UTC days", () => {
  it("keeps an evening session on the day the athlete actually trained", () => {
    const utcWouldSay = EVENING_IN_THE_AMERICAS.toISOString().slice(0, 10);
    const local = localDateKey(EVENING_IN_THE_AMERICAS);

    // This assertion only bites when the test runs west of UTC. Stated as a
    // relationship rather than a literal so the suite is honest on any machine:
    // the local key must track the local calendar, whatever that is here.
    const expected = [
      EVENING_IN_THE_AMERICAS.getFullYear(),
      String(EVENING_IN_THE_AMERICAS.getMonth() + 1).padStart(2, "0"),
      String(EVENING_IN_THE_AMERICAS.getDate()).padStart(2, "0"),
    ].join("-");
    expect(local).toBe(expected);

    if (EVENING_IN_THE_AMERICAS.getTimezoneOffset() > 0) {
      // Running west of UTC, which is where the bug showed. Prove they differ,
      // so this is not silently passing for the wrong reason.
      expect(local).not.toBe(utcWouldSay);
    }
  });

  it("todayKey agrees with localDateKey for the same instant", () => {
    // The Log form now derives the workout date from todayKey. If these two
    // ever diverge, a saved workout and its check-in split across two days.
    vi.useFakeTimers();
    vi.setSystemTime(EVENING_IN_THE_AMERICAS);
    expect(todayKey()).toBe(localDateKey(EVENING_IN_THE_AMERICAS));
  });

  it("does not shift the day for an instant that is unambiguous everywhere", () => {
    // Midday UTC is the same calendar day across every populated offset, so
    // this pins the ordinary case without depending on the runner's zone.
    const midday = new Date("2026-08-07T12:00:00Z");
    expect(localDateKey(midday)).toBe("2026-08-07");
  });

  it("pads single digit months and days", () => {
    expect(localDateKey(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});
