import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messagesStream: vi.fn(),
  getProfile: vi.fn(),
  getTrainingSets: vi.fn(),
  getCheckins: vi.fn(),
  getRecentPlanSessionContexts: vi.fn(),
  getRecentWorkoutNotes: vi.fn(),
  getSessionWithSets: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { stream: mocks.messagesStream };
  },
}));

vi.mock("@/lib/ai-provider", () => ({
  LOCAL_MODELS: { coach: "local-test" },
  LOCAL_TIMEOUT_MS: { coach: 1_000 },
  cloudAvailable: () => true,
  localOptions: () => ({}),
  preferredProvider: () => "cloud",
}));

vi.mock("@/lib/data", () => ({
  getProfile: mocks.getProfile,
  getTrainingSets: mocks.getTrainingSets,
  getCheckins: mocks.getCheckins,
  getRecentPlanSessionContexts: mocks.getRecentPlanSessionContexts,
  getRecentWorkoutNotes: mocks.getRecentWorkoutNotes,
  getSessionWithSets: mocks.getSessionWithSets,
}));

vi.mock("@/lib/analytics/context", () => ({
  buildCoachContext: () => ({ summary: "General athlete context" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-id" } } }),
    },
  }),
}));

import { POST } from "@/app/api/coach/route";

const selectedSession = {
  id: "session-id",
  performed_at: "2026-09-08T12:00:00.000Z",
  notes: "Felt steady",
  sets: [
    {
      id: "set-id",
      reps: 5,
      weight: 100,
      rpe: 8,
      set_number: 1,
      exerciseId: "squat",
      exerciseName: "Back Squat",
      muscleGroup: "Quads",
      movementPattern: "Squat",
      isMajor: true,
    },
  ],
};

function request(sessionId: string) {
  return new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messages: [{ role: "user", content: "Review this workout." }],
    }),
  });
}

beforeEach(() => {
  mocks.messagesStream.mockReset();
  mocks.getProfile.mockReset().mockResolvedValue({ units: "kg" });
  mocks.getTrainingSets.mockReset().mockResolvedValue([]);
  mocks.getCheckins.mockReset().mockResolvedValue([]);
  mocks.getRecentPlanSessionContexts.mockReset().mockResolvedValue([]);
  mocks.getRecentWorkoutNotes.mockReset().mockResolvedValue([]);
  mocks.getSessionWithSets.mockReset().mockResolvedValue(selectedSession);
  mocks.messagesStream.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Review" } };
    },
  });
});

describe("coach selected workout context", () => {
  it("loads the requested workout and gives its exact sets to the model", async () => {
    const response = await POST(request("session-id"));
    await expect(response.text()).resolves.toBe("Review");

    expect(mocks.getSessionWithSets).toHaveBeenCalledWith(expect.anything(), "kg", "session-id");
    const call = mocks.messagesStream.mock.calls[0][0];
    expect(call.system[1].text).toContain("General athlete context");
    expect(call.system[2].text).toContain("=== SELECTED WORKOUT ===");
    expect(call.system[2].text).toContain("Back Squat: set 1: 100 kg x 5, RPE 8");
  });

  it("rejects a workout that is not visible to the signed in athlete", async () => {
    mocks.getSessionWithSets.mockResolvedValue(null);

    const response = await POST(request("someone-elses-session"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Workout not found." });
    expect(mocks.messagesStream).not.toHaveBeenCalled();
  });

  it("gives the general Coach durable plan adherence memory", async () => {
    mocks.getTrainingSets.mockResolvedValue([
      {
        date: "2026-09-08T12:00:00.000Z",
        sessionId: "session-id",
        exerciseId: "squat",
        exerciseName: "Back Squat",
        muscleGroup: "Quads",
        isMajor: true,
        reps: 5,
        weight: 100,
        rpe: 8,
      },
    ]);
    mocks.getRecentPlanSessionContexts.mockResolvedValue([
      {
        sessionId: "session-id",
        performedAt: "2026-09-08T12:00:00.000Z",
        planId: "plan-id",
        planDayId: "day-id",
        snapshot: {
          version: 1,
          dayIndex: 0,
          dayName: "Lower A",
          planned: [{
            exerciseId: "squat",
            name: "Back Squat",
            position: 0,
            sets: 3,
            repLow: 5,
            repHigh: 8,
            rpeTarget: 8,
          }],
          substitutions: [],
        },
      },
    ]);

    const response = await POST(request("session-id"));
    await response.text();

    const call = mocks.messagesStream.mock.calls[0][0];
    expect(call.system[1].text).toContain("=== PLAN ADHERENCE MEMORY ===");
    expect(call.system[1].text).toContain("Lower A: logged 1 of 3 planned sets");
  });

  it("gives Coach bounded recent workout notes", async () => {
    mocks.getRecentWorkoutNotes.mockResolvedValue([
      { performedAt: "2026-09-08T12:00:00.000Z", note: "Grip felt weak after poor sleep." },
    ]);

    const response = await POST(request("session-id"));
    await response.text();

    const call = mocks.messagesStream.mock.calls[0][0];
    expect(call.system[1].text).toContain("=== RECENT WORKOUT NOTES ===");
    expect(call.system[1].text).toContain('2026-09-08: "Grip felt weak after poor sleep."');
  });
});
