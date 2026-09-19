import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  getTrainingSets: vi.fn(),
  recordScanLogs: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: mocks.messagesCreate };
  },
}));

vi.mock("@/lib/ai-model", () => ({
  SCAN_MODEL: "scan-test-model",
  toUsageReport: () => ({ model: "scan-test-model", inputTokens: 12, outputTokens: 4 }),
}));

vi.mock("@/lib/ai-provider", () => ({
  LOCAL_MODELS: { scan: "local-scan" },
  LOCAL_TIMEOUT_MS: { scan: 1_000 },
  cloudAvailable: () => true,
  localOptions: () => ({}),
  preferredProvider: () => "cloud",
}));

vi.mock("@/lib/data", () => ({
  getTrainingSets: mocks.getTrainingSets,
}));

vi.mock("@/lib/scan-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan-log")>();
  return { ...actual, recordScanLogs: mocks.recordScanLogs };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-id" } } }),
    },
  }),
}));

import { POST } from "@/app/api/scan/route";

const attemptId = "9c4e10b6-f747-4f33-8ff8-e90a8009cfa2";
const reading = {
  detected: true,
  exercise: "Back Squat",
  equipment: "barbell",
  total_weight_kg: 100,
  per_side_plates_kg: [20, 20],
  reps: 5,
  confidence: "high",
  note: "A loaded bar is visible.",
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Scanner test browser",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getTrainingSets.mockReset().mockResolvedValue([]);
  mocks.recordScanLogs.mockReset().mockResolvedValue("recorded");
  mocks.messagesCreate.mockReset().mockResolvedValue({
    content: [{ type: "tool_use", id: "tool", name: "report_lift", input: reading }],
    usage: { input_tokens: 12, output_tokens: 4 },
  });
});

describe("scanner route diagnostics", () => {
  it("records the request and complete model reading under one attempt id", async () => {
    const response = await POST(request({
      images: ["data:image/jpeg;base64,YWJj"],
      attemptId,
      captureMode: "photo",
      client: { online: true, standalone: false, facing: "environment" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ attemptId, reading });
    expect(mocks.recordScanLogs).toHaveBeenCalledTimes(2);
    expect(mocks.recordScanLogs.mock.calls[0][2][0]).toMatchObject({
      attemptId,
      event: "analysis_started",
      captureMode: "photo",
      frameCount: 1,
      details: { userAgent: "Scanner test browser" },
    });
    expect(mocks.recordScanLogs.mock.calls[1][2][0]).toMatchObject({
      attemptId,
      event: "analysis_completed",
      status: "succeeded",
      provider: "cloud",
      model: "scan-test-model",
      reading,
    });
    expect(JSON.stringify(mocks.recordScanLogs.mock.calls)).not.toContain("YWJj");
  });

  it("records validation failures before making a model call", async () => {
    const response = await POST(request({ images: ["not-an-image"], attemptId }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ attemptId });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
    expect(mocks.recordScanLogs).toHaveBeenCalledWith(
      expect.anything(),
      "user-id",
      [expect.objectContaining({
        attemptId,
        event: "request_rejected",
        stage: "validation",
        status: "failed",
        details: { reason: "no_valid_frames", receivedItems: 1 },
      })],
    );
  });

  it("records provider errors and returns the same reference to the client", async () => {
    mocks.messagesCreate.mockRejectedValue(new Error("provider unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({
      images: ["data:image/jpeg;base64,YWJj"],
      attemptId,
      captureMode: "photo",
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ attemptId });
    expect(mocks.recordScanLogs.mock.calls.at(-1)?.[2][0]).toMatchObject({
      attemptId,
      event: "analysis_failed",
      provider: "cloud",
      details: { name: "Error", message: "provider unavailable" },
    });
    consoleError.mockRestore();
  });
});
