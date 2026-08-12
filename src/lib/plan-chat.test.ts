// Tests for the coach-chat trust boundary. parseCoachTurn turns raw model tool
// output into plan ops: anything unresolved must be DROPPED (and reported),
// never guessed. This locks that contract, including the falsy-zero handling
// (dayIndex 0 / position 0 are valid, not "missing").

import { describe, it, expect } from "vitest";
import { parseCoachTurn } from "@/lib/plan-chat";

const refs = new Map<string, string>([
  ["e5", "uuid-5"],
  ["e6", "uuid-6"],
]);

describe("parseCoachTurn — reply", () => {
  it("trims the reply and coerces a non-string to empty", () => {
    expect(parseCoachTurn({ reply: "  hello  ", ops: [] }, refs).turn.reply).toBe("hello");
    expect(parseCoachTurn({ reply: 42, ops: [] }, refs).turn.reply).toBe("");
    expect(parseCoachTurn(null, refs).turn.reply).toBe("");
  });

  it("caps the reply at 600 characters", () => {
    const long = "a".repeat(700);
    expect(parseCoachTurn({ reply: long, ops: [] }, refs).turn.reply).toHaveLength(600);
  });

  it("treats a non-array ops field as no ops", () => {
    expect(parseCoachTurn({ reply: "hi", ops: "nope" }, refs).turn.ops).toEqual([]);
  });
});

describe("parseCoachTurn — op validation", () => {
  it("drops any op missing a reason or a day index", () => {
    const { turn, dropped } = parseCoachTurn(
      { ops: [{ op: "remove_exercise", dayIndex: 0, position: 0 }] },
      refs,
    );
    expect(turn.ops).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("accepts a valid replace and resolves the exerciseRef through the map", () => {
    const { turn, dropped } = parseCoachTurn(
      { ops: [{ op: "replace_exercise", dayIndex: 1, position: 2, exerciseRef: "e5", reason: "better fit" }] },
      refs,
    );
    expect(dropped).toEqual([]);
    expect(turn.ops).toEqual([
      { op: "replace_exercise", dayIndex: 1, position: 2, exerciseId: "uuid-5", reason: "better fit" },
    ]);
  });

  it("drops a replace whose ref is not in the library", () => {
    const { turn, dropped } = parseCoachTurn(
      { ops: [{ op: "replace_exercise", dayIndex: 1, position: 2, exerciseRef: "e99", reason: "x" }] },
      refs,
    );
    expect(turn.ops).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("keeps ops that legitimately address day 0 / position 0", () => {
    const { turn } = parseCoachTurn(
      { ops: [{ op: "remove_exercise", dayIndex: 0, position: 0, reason: "drop the first lift" }] },
      refs,
    );
    expect(turn.ops).toEqual([
      { op: "remove_exercise", dayIndex: 0, position: 0, reason: "drop the first lift" },
    ]);
  });

  it("requires a complete prescription to insert an exercise", () => {
    const incomplete = parseCoachTurn(
      { ops: [{ op: "insert_exercise", dayIndex: 0, exerciseRef: "e5", sets: 3, reason: "add" }] },
      refs,
    );
    expect(incomplete.turn.ops).toEqual([]);
    expect(incomplete.dropped).toHaveLength(1);

    const complete = parseCoachTurn(
      { ops: [{ op: "insert_exercise", dayIndex: 0, position: 1, exerciseRef: "e5", sets: 3, repLow: 8, repHigh: 12, reason: "add" }] },
      refs,
    );
    expect(complete.turn.ops).toEqual([
      {
        op: "insert_exercise",
        dayIndex: 0,
        position: 1,
        exerciseId: "uuid-5",
        sets: 3,
        repLow: 8,
        repHigh: 12,
        rpeTarget: null,
        restSeconds: null,
        reason: "add",
      },
    ]);
  });

  it("requires both positions for a reorder", () => {
    const missing = parseCoachTurn(
      { ops: [{ op: "reorder", dayIndex: 0, toPosition: 2, reason: "x" }] },
      refs,
    );
    expect(missing.turn.ops).toEqual([]);
    expect(missing.dropped).toHaveLength(1);

    const ok = parseCoachTurn(
      { ops: [{ op: "reorder", dayIndex: 0, fromPosition: 0, toPosition: 2, reason: "x" }] },
      refs,
    );
    expect(ok.turn.ops).toEqual([
      { op: "reorder", dayIndex: 0, fromPosition: 0, toPosition: 2, reason: "x" },
    ]);
  });

  it("drops an op the app does not support", () => {
    const { turn, dropped } = parseCoachTurn(
      { ops: [{ op: "frobnicate_day", dayIndex: 0, reason: "x" }] },
      refs,
    );
    expect(turn.ops).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});
