import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  recordScanLogs: vi.fn(),
}));

vi.mock("@/lib/scan-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan-log")>();
  return { ...actual, recordScanLogs: mocks.recordScanLogs };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

import { POST } from "@/app/api/scan/log/route";

const attemptId = "9c4e10b6-f747-4f33-8ff8-e90a8009cfa2";
const event = {
  attemptId,
  event: "capture_completed",
  stage: "capture",
  status: "succeeded",
  captureMode: "photo",
  frameCount: 1,
  durationMs: 420,
  details: { mimeType: "image/jpeg" },
};

function request(events: unknown) {
  return new Request("http://localhost/api/scan/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
}

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-id" } } });
  mocks.recordScanLogs.mockReset().mockResolvedValue("recorded");
});

describe("scanner client log route", () => {
  it("validates and records an authenticated event batch", async () => {
    const response = await POST(request([event]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: true, recorded: true });
    expect(mocks.recordScanLogs).toHaveBeenCalledWith(
      expect.anything(),
      "user-id",
      [event],
    );
  });

  it("rejects malformed events before the database boundary", async () => {
    const response = await POST(request([{ ...event, attemptId: "not-a-uuid" }]));

    expect(response.status).toBe(400);
    expect(mocks.recordScanLogs).not.toHaveBeenCalled();
  });

  it("keeps the endpoint rollout-safe while migration 0021 is absent", async () => {
    mocks.recordScanLogs.mockResolvedValue("unavailable");

    const response = await POST(request([event]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: true, recorded: false });
  });

  it("does not accept client diagnostics without an authenticated athlete", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request([event]));

    expect(response.status).toBe(401);
    expect(mocks.recordScanLogs).not.toHaveBeenCalled();
  });

  it("retains queued events when a real database write fails", async () => {
    mocks.recordScanLogs.mockResolvedValue("failed");

    const response = await POST(request([event]));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Scanner events could not be recorded.",
    });
  });
});
