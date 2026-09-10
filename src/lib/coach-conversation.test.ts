import { describe, expect, it } from "vitest";
import {
  coachConversationName,
  sendableCoachHistory,
} from "@/lib/coach-conversation";

describe("coachConversationName", () => {
  it("preserves the existing general Coach conversation", () => {
    expect(coachConversationName(null)).toBe("coach");
  });

  it("gives every selected workout its own conversation", () => {
    expect(coachConversationName("session-a")).toBe("coach.workout.session-a");
    expect(coachConversationName("session-b")).not.toBe(coachConversationName("session-a"));
  });
});

describe("sendableCoachHistory", () => {
  it("keeps real turns and excludes UI errors and empty placeholders", () => {
    expect(sendableCoachHistory([
      { role: "user", content: "What should I do next?" },
      { role: "assistant", content: "Add one rep." },
      { role: "user", content: "Review this." },
      { role: "assistant", content: "Network failed.", error: true },
    ])).toEqual([
      { role: "user", content: "What should I do next?" },
      { role: "assistant", content: "Add one rep." },
    ]);
  });

  it("removes a stale empty request placeholder with its unanswered question", () => {
    expect(sendableCoachHistory([
      { role: "user", content: "Review this." },
      { role: "assistant", content: "" },
    ])).toEqual([]);
  });
});
