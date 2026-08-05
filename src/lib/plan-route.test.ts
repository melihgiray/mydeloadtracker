import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  createPlan: vi.fn(),
  getAthleteLifts: vi.fn(),
  library: [
    {
      id: "squat-id",
      user_id: null,
      name: "Squat",
      muscle_group: "Quads",
      movement_pattern: "Squat",
      equipment: "barbell",
      is_major: true,
      hidden: false,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "shoulder-id",
      user_id: null,
      name: "Shoulder Press",
      muscle_group: "Shoulders",
      movement_pattern: "Vertical Push",
      equipment: "barbell",
      is_major: true,
      hidden: false,
      created_at: "2026-07-01T00:00:00.000Z",
    },
  ],
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: mocks.messagesCreate };
  },
}));

vi.mock("@/lib/data", () => ({
  getCheckins: vi.fn().mockResolvedValue([]),
  getExercises: vi.fn().mockResolvedValue(mocks.library),
  getProfile: vi.fn().mockResolvedValue({
    id: "user-id",
    full_name: null,
    units: "kg",
    bodyweight: null,
    sex: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  }),
  getTrainingSets: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/plans", () => ({
  createPlan: mocks.createPlan,
}));

vi.mock("@/lib/athlete-lifts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athlete-lifts")>(
    "@/lib/athlete-lifts",
  );
  return { ...actual, getAthleteLifts: mocks.getAthleteLifts };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-id" } } }),
    },
  }),
}));

import { POST } from "@/app/api/plan/route";

const intake = {
  daysPerWeek: 1,
  sessionMinutes: 60,
  equipment: ["barbell"],
  goal: "both",
  avoid: ["No overhead pressing"],
  splitPreference: "full_body",
  note: null,
};

function generated(exerciseId: string) {
  return {
    name: "Measured Full Body",
    split: "full_body",
    mesocycle_weeks: 5,
    deload_week: 5,
    notes: null,
    days: [
      {
        name: "Full Body A",
        focus: null,
        exercises: [
          {
            exercise_id: exerciseId,
            sets: 3,
            rep_low: 5,
            rep_high: 8,
            rpe_target: 8,
            rest_seconds: 180,
            role: "primary",
            note: null,
          },
        ],
      },
    ],
  };
}

function toolResponse(input: unknown) {
  return {
    content: [{ type: "tool_use", id: "tool-id", name: "save_training_plan", input }],
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

function request() {
  return new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intake),
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.AI_PLAN_PROVIDER;
  delete process.env.OLLAMA_BASE_URL;
  mocks.messagesCreate.mockReset();
  mocks.createPlan.mockReset();
  mocks.getAthleteLifts.mockReset();
  mocks.createPlan.mockResolvedValue("plan-id");
  mocks.getAthleteLifts.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("POST /api/plan validation and regeneration", () => {
  it("does not invent empty PR history when lift claims are unavailable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAthleteLifts.mockRejectedValue(new Error("claims unavailable"));
    mocks.messagesCreate.mockResolvedValue(toolResponse(generated("e1")));

    try {
      const response = await POST(request());
      const body = (await response.json()) as { error?: string };

      expect(response.status).toBe(502);
      expect(body.error).toContain("could not build a valid plan");
      expect(mocks.messagesCreate).not.toHaveBeenCalled();
      expect(mocks.createPlan).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith("Plan generation error:", expect.any(Error));
    } finally {
      errorLog.mockRestore();
    }
  });

  it("regenerates once with the named avoid conflict, then persists the valid plan", async () => {
    mocks.messagesCreate
      .mockResolvedValueOnce(toolResponse(generated("e2")))
      .mockResolvedValueOnce(toolResponse(generated("e1")));

    const response = await POST(request());
    const body = (await response.json()) as {
      planId?: string;
      provider?: string;
      usage?: { inputTokens: number; outputTokens: number };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      planId: "plan-id",
      provider: "cloud",
      usage: { inputTokens: 200, outputTokens: 400 },
    });
    expect(mocks.messagesCreate).toHaveBeenCalledTimes(2);
    expect(mocks.messagesCreate.mock.calls[0][0].messages[0].content).toContain(
      '"id": "e1"',
    );
    expect(mocks.messagesCreate.mock.calls[0][0].messages[0].content).not.toContain(
      "squat-id",
    );
    expect(mocks.messagesCreate.mock.calls[1][0].messages[0].content).toContain(
      "conflicts with “No overhead pressing”",
    );
    expect(mocks.createPlan).toHaveBeenCalledTimes(1);
    expect(mocks.createPlan.mock.calls[0][1].days[0].exercises[0].exercise_id).toBe(
      "squat-id",
    );
  });

  it("surfaces the specific problem and never persists after two rejected candidates", async () => {
    mocks.messagesCreate.mockResolvedValue(toolResponse(generated("invented-id")));

    const response = await POST(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain("outside the available library");
    expect(mocks.messagesCreate).toHaveBeenCalledTimes(2);
    expect(mocks.createPlan).not.toHaveBeenCalled();
  });
});
