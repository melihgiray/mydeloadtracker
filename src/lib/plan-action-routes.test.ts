import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  parseCoachTurn: vi.fn(),
  previewPlanActions: vi.fn(),
  applyPatchToPlan: vi.fn(),
  plan: {
    id: "plan-id",
    equipment: ["barbell"],
    days: [],
  },
  library: [{ id: "exercise-id", name: "Bench Press", equipment: "barbell" }],
}));

const plan = mocks.plan;
const library = mocks.library;

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: mocks.messagesCreate };
  },
}));

vi.mock("@/lib/ai-model", () => ({
  PLAN_MODEL: "test-model",
  toUsageReport: () => ({ inputTokens: 1, outputTokens: 1 }),
}));

vi.mock("@/lib/ai-provider", () => ({ cloudAvailable: () => true }));

vi.mock("@/lib/data", () => ({
  getExercises: vi.fn().mockResolvedValue(mocks.library),
  getProfile: vi.fn().mockResolvedValue({ units: "kg", bodyweight: null, sex: null }),
  getTrainingSets: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/athlete-lifts", () => ({
  getAthleteLifts: vi.fn().mockResolvedValue([]),
  mergeSelfReported: () => [],
}));

vi.mock("@/lib/analytics/records", () => ({ buildRecords: () => [] }));
vi.mock("@/lib/analytics/setVolume", () => ({ buildSetVolume: () => ({}) }));
vi.mock("@/lib/analytics/weak-points", () => ({
  assessWeakPoints: () => ({ insufficientData: true, muscles: [] }),
}));

vi.mock("@/lib/plan-generation", () => ({
  EQUIPMENT_TAGS: ["barbell"],
  filterExercisesForEquipment: (items: unknown[]) => items,
  referenceExercises: (items: { id: string }[]) =>
    items.map((exercise, index) => ({ reference: `e${index + 1}`, exercise })),
}));

vi.mock("@/lib/plan-chat", () => ({
  PLAN_CHAT_TOOL_SCHEMA: { type: "object", properties: {} },
  buildPlanChatSystem: () => "system",
  parseCoachTurn: mocks.parseCoachTurn,
}));

vi.mock("@/lib/plan-action-preview", () => ({
  previewPlanActions: mocks.previewPlanActions,
}));

vi.mock("@/lib/plan-edit", () => ({
  applyPatchToPlan: mocks.applyPatchToPlan,
}));

vi.mock("@/lib/plans", () => ({
  getActivePlan: vi.fn().mockResolvedValue(mocks.plan),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-id" } } }),
    },
  }),
}));

import { POST as chatPOST } from "@/app/api/plan/chat/route";
import { POST as editPOST } from "@/app/api/plan/edit/route";

const op = { op: "rename_day", dayIndex: 0, name: "Upper A", reason: "Clearer name." } as const;

beforeEach(() => {
  mocks.messagesCreate.mockReset().mockResolvedValue({
    content: [{ type: "tool_use", id: "tool", name: "reply_and_edit", input: {} }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  mocks.parseCoachTurn.mockReset().mockReturnValue({ turn: { reply: "I suggest this.", ops: [op] }, dropped: [] });
  mocks.previewPlanActions.mockReset().mockReturnValue({
    plan,
    applied: [op],
    rejected: [],
    changes: [{ title: "Rename a training day", before: "Upper", after: "Upper A", reason: op.reason }],
  });
  mocks.applyPatchToPlan.mockReset().mockResolvedValue({
    applied: [op],
    rejected: [],
    revision: 1,
    summary: op.reason,
  });
});

describe("plan Coach action confirmation", () => {
  it("returns a validated preview without persisting the model proposal", async () => {
    const response = await chatPOST(
      new Request("http://localhost/api/plan/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Rename my first day." }] }),
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      reply: "I suggest this.",
      proposed: [op],
      preview: [{ before: "Upper", after: "Upper A" }],
      revision: null,
    });
    expect(mocks.previewPlanActions).toHaveBeenCalled();
    expect(mocks.applyPatchToPlan).not.toHaveBeenCalled();
  });

  it("records an explicitly applied Coach proposal with the chat source", async () => {
    const response = await editPOST(
      new Request("http://localhost/api/plan/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: [op], source: "athlete_chat" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.applyPatchToPlan).toHaveBeenCalledWith(
      expect.anything(),
      plan,
      [op],
      "athlete_chat",
      library,
    );
  });
});
