import { describe, expect, it } from "vitest";
import { summariseRecentWorkoutNotes } from "@/lib/workout-notes";

describe("summariseRecentWorkoutNotes", () => {
  it("keeps recent athlete context compact and visibly quoted", () => {
    const summary = summariseRecentWorkoutNotes([
      { performedAt: "2026-09-08T12:00:00.000Z", note: "Shoulder felt fine\nafter warmups." },
    ]);

    expect(summary).toContain("=== RECENT WORKOUT NOTES ===");
    expect(summary).toContain('2026-09-08: "Shoulder felt fine after warmups."');
  });

  it("stays absent when there are no meaningful notes", () => {
    expect(summariseRecentWorkoutNotes([])).toBeNull();
    expect(summariseRecentWorkoutNotes([
      { performedAt: "2026-09-08T12:00:00.000Z", note: "   " },
    ])).toBeNull();
  });

  it("bounds the number and length of notes sent to Coach", () => {
    const summary = summariseRecentWorkoutNotes(
      Array.from({ length: 10 }, (_, index) => ({
        performedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        note: `${index}:${"x".repeat(300)}`,
      })),
    )!;

    expect(summary.split("\n")).toHaveLength(9);
    expect(summary).not.toContain("8:xxx");
    expect(summary).toContain("...");
  });
});
