import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  isScanAttemptId,
  parseClientScanLogEvent,
  recordScanLogs,
  scanErrorDetails,
} from "@/lib/scan-log";

function client(result: { error: { code: string; message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(result);
  return {
    supabase: { from: () => ({ insert }) } as unknown as SupabaseClient,
    insert,
  };
}

const event = {
  attemptId: "9c4e10b6-f747-4f33-8ff8-e90a8009cfa2",
  event: "analysis_completed",
  stage: "analysis",
  status: "succeeded" as const,
  captureMode: "video" as const,
  frameCount: 8,
  durationMs: 6420,
  provider: "cloud",
  model: "vision-model",
  details: { inputTokens: 900 },
};

describe("scanner diagnostic logging", () => {
  it("writes queryable metadata without any capture media", async () => {
    const { supabase, insert } = client({ error: null });

    await expect(recordScanLogs(supabase, "user-id", [event])).resolves.toBe("recorded");
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      user_id: "user-id",
      attempt_id: event.attemptId,
      event: "analysis_completed",
      frame_count: 8,
      details: { inputTokens: 900 },
    })]);
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toContain("base64");
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toContain("image");
  });

  it("keeps scanning rollout-safe while migration 0021 is absent", async () => {
    const { supabase } = client({
      error: { code: "PGRST205", message: "table not found" },
    });
    await expect(recordScanLogs(supabase, "user-id", [event])).resolves.toBe("unavailable");
  });

  it("reports but does not throw on an unexpected logging failure", async () => {
    const { supabase } = client({
      error: { code: "PGRST000", message: "database unavailable" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordScanLogs(supabase, "user-id", [event])).resolves.toBe("failed");
    expect(consoleError).toHaveBeenCalledWith("Scanner log write failed:", {
      code: "PGRST000",
      message: "database unavailable",
    });
    consoleError.mockRestore();
  });

  it("accepts only real UUID attempt ids and bounds error text", () => {
    expect(isScanAttemptId(event.attemptId)).toBe(true);
    expect(isScanAttemptId("not-an-id")).toBe(false);
    expect(scanErrorDetails(new Error("x".repeat(800))).message).toHaveLength(500);
  });

  it("validates client events before they cross the database boundary", () => {
    expect(parseClientScanLogEvent(event)).toMatchObject({
      attemptId: event.attemptId,
      event: "analysis_completed",
      frameCount: 8,
    });
    expect(parseClientScanLogEvent({ ...event, frameCount: 11 })).toBeNull();
    expect(parseClientScanLogEvent({ ...event, attemptId: "bad" })).toBeNull();
    expect(parseClientScanLogEvent({ ...event, details: { value: "x".repeat(9_000) } })).toBeNull();
  });
});
