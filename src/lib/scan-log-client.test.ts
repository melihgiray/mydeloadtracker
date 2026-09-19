import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushScanLogQueue,
  queueScanLog,
  scanLogQueueSize,
} from "@/lib/scan-log-client";

const attemptId = "9c4e10b6-f747-4f33-8ff8-e90a8009cfa2";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanner log delivery queue", () => {
  it("keeps an offline failure and flushes it when connectivity returns", async () => {
    const event = {
      attemptId,
      event: "capture_failed",
      stage: "capture",
      status: "failed" as const,
      captureMode: "video" as const,
      frameCount: 0,
      details: { reason: "permission_denied" },
    };
    queueScanLog(event);
    await flushScanLogQueue();
    expect(scanLogQueueSize()).toBe(1);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", fetchMock);
    await flushScanLogQueue();

    expect(scanLogQueueSize()).toBe(0);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.events).toEqual([event]);
    expect(JSON.stringify(sent)).not.toContain("base64");
  });

  it("drains an event added while an earlier batch is still being sent", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    let finishFirst: ((value: { ok: boolean }) => void) | undefined;
    const firstResponse = new Promise<{ ok: boolean }>((resolve) => {
      finishFirst = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    queueScanLog({
      attemptId,
      event: "capture_started",
      stage: "capture",
      status: "started",
      captureMode: "video",
    });
    queueScanLog({
      attemptId,
      event: "permission_granted",
      stage: "permission",
      status: "succeeded",
      captureMode: "video",
    });
    finishFirst?.({ ok: true });
    await flushScanLogQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scanLogQueueSize()).toBe(0);
  });
});
