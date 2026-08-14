import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  getTrainingSets: vi.fn(),
  getAthleteLifts: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: mocks.messagesCreate };
  },
}));

vi.mock("@/lib/data", () => ({
  getExercises: vi.fn().mockResolvedValue([]),
  getProfile: vi.fn().mockResolvedValue({ units: "kg", bodyweight: null, sex: null }),
  getTrainingSets: mocks.getTrainingSets,
}));

vi.mock("@/lib/athlete-lifts", () => ({
  getAthleteLifts: mocks.getAthleteLifts,
  mergeSelfReported: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/plans", () => ({
  getActivePlan: vi.fn().mockResolvedValue({ id: "plan-id", equipment: [], days: [] }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-id" } } }),
    },
  }),
}));

vi.mock("@/lib/plan-generation", () => ({
  EQUIPMENT_TAGS: [],
  filterExercisesForEquipment: vi.fn().mockReturnValue([]),
  referenceExercises: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/plan-chat", () => ({
  PLAN_CHAT_TOOL_SCHEMA: { type: "object", properties: {} },
  buildPlanChatPrompt: vi.fn().mockReturnValue("chat prompt"),
  buildPlanChatSystem: vi.fn().mockReturnValue("chat system"),
  parseCoachTurn: vi.fn().mockReturnValue({
    turn: { reply: "No change needed.", ops: [] },
    dropped: [],
  }),
}));

vi.mock("@/lib/plan-review", () => ({
  buildPlanReview: vi.fn().mockReturnValue({
    from: "2026-07-20",
    to: "2026-08-05",
    sessionsLogged: 0,
    sessionsPlanned: 0,
    lifts: [],
    stalled: [],
    untrained: [],
  }),
  buildWeeklyReviewPrompt: vi.fn().mockReturnValue("review prompt"),
  isBigChange: vi.fn().mockReturnValue(false),
  withoutDayEmptyingOps: vi.fn().mockImplementation((_plan, ops) => ({ ops, dropped: [] })),
}));

vi.mock("@/lib/analytics/records", () => ({ buildRecords: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/analytics/setVolume", () => ({ buildSetVolume: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/analytics/weak-points", () => ({
  assessWeakPoints: vi.fn().mockReturnValue({ insufficientData: true, muscles: [] }),
}));

import { POST as chatPOST } from "@/app/api/plan/chat/route";
import { POST as reviewPOST } from "@/app/api/plan/review/route";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function chatRequest() {
  return new Request("http://localhost/api/plan/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Why is this first?" }),
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.messagesCreate.mockReset();
  mocks.getTrainingSets.mockReset();
  mocks.getAthleteLifts.mockReset();
  mocks.getTrainingSets.mockResolvedValue([]);
  mocks.getAthleteLifts.mockResolvedValue([]);
  mocks.messagesCreate.mockResolvedValue({
    content: [{ type: "tool_use", id: "tool-id", name: "reply", input: {} }],
    usage: { input_tokens: 10, output_tokens: 10 },
  });
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  consoleErrorSpy.mockRestore();
});

const routes = [
  { name: "plan chat", run: () => chatPOST(chatRequest()) },
  { name: "weekly review", run: () => reviewPOST() },
];

describe.each(routes)("$name context reads", ({ run }) => {
  it.each([
    ["logged training", mocks.getTrainingSets],
    ["self-reported lifts", mocks.getAthleteLifts],
  ])("does not invent empty %s when the read fails", async (_label, read) => {
    read.mockRejectedValue(new Error("context unavailable"));

    const response = await run();

    expect(response.status).toBe(502);
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });
});
