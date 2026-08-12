// Tests for the presentation helpers: buildActivity's calendar bucketing (an
// easy place for off-by-one week math to regress) and buildTodaysCall's rule
// that a recommended deload overrides the readiness band for the hero card.

import { describe, it, expect } from "vitest";
import { buildActivity, buildTodaysCall } from "@/lib/ui";
import { localDateKey } from "@/lib/analytics/dates";
import type { ReadinessReport } from "@/lib/analytics/readiness";
import type { DeloadReport } from "@/lib/analytics/deload";

const now = new Date("2026-06-08T12:00:00");

function keyDaysAgo(days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return localDateKey(d);
}

describe("buildActivity", () => {
  it("buckets trained days into weeks and counts the current-week streak", () => {
    // Trained today, 3 days ago (both current week) and 10 days ago (prior week).
    const trained = new Set([keyDaysAgo(0), keyDaysAgo(3), keyDaysAgo(10)]);
    const a = buildActivity(trained, now);

    expect(a.weeklyCounts).toHaveLength(8);
    expect(a.weeklyCounts[7]).toBe(2); // current 7-day window
    expect(a.weeklyCounts[6]).toBe(1); // previous 7-day window
    expect(a.sessionsThisWeek).toBe(2);
    expect(a.streakWeeks).toBe(2); // current + previous week both have a session

    expect(a.last14).toHaveLength(14);
    expect(a.last14[13]).toBe(true); // today
    expect(a.last14[10]).toBe(true); // 3 days ago
    expect(a.last14[3]).toBe(true); // 10 days ago
    expect(a.last14[0]).toBe(false); // 13 days ago, not trained
  });

  it("returns an all-zero picture with no trained days", () => {
    const a = buildActivity(new Set(), now);
    expect(a.streakWeeks).toBe(0);
    expect(a.sessionsThisWeek).toBe(0);
    expect(a.weeklyCounts.every((c) => c === 0)).toBe(true);
    expect(a.last14.every((d) => d === false)).toBe(true);
  });

  it("breaks the streak at the first week with no sessions", () => {
    // Trained this week and two weeks ago, but NOT last week.
    const trained = new Set([keyDaysAgo(0), keyDaysAgo(14)]);
    const a = buildActivity(trained, now);
    expect(a.streakWeeks).toBe(1); // stops at the empty previous week
  });
});

function readiness(id: ReadinessReport["band"]["id"], tone: ReadinessReport["band"]["tone"]) {
  return { score: 50, band: { id, tone, label: "" }, factors: [], topDrivers: [] } as unknown as ReadinessReport;
}
function deload(recommended: boolean, triggeredCount = 0) {
  return { recommended, triggeredCount, signals: [], reasons: [] } as unknown as DeloadReport;
}

describe("buildTodaysCall", () => {
  it("a recommended deload overrides the band", () => {
    const call = buildTodaysCall(readiness("fresh", "good"), deload(true, 2));
    expect(call.state).toBe("back-off");
    expect(call.verdict).toBe("Back off");
    expect(call.tone).toBe("bad");
  });

  it("maps readiness bands to calls when no deload is recommended", () => {
    expect(buildTodaysCall(readiness("fresh", "good"), deload(false)).state).toBe("push");
    expect(buildTodaysCall(readiness("solid", "good"), deload(false)).state).toBe("push");
    expect(buildTodaysCall(readiness("caution", "caution"), deload(false)).state).toBe("hold");
    expect(buildTodaysCall(readiness("deload", "bad"), deload(false)).state).toBe("back-off");
  });
});
