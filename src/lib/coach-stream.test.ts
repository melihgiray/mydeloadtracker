import { describe, expect, it, vi } from "vitest";
import { readCoachStream } from "@/lib/coach-stream";

describe("readCoachStream", () => {
  it("reassembles UTF-8 text split through a multi-byte character", async () => {
    const bytes = new TextEncoder().encode("Strong 💪");
    const split = bytes.length - 2;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const onText = vi.fn();

    await expect(readCoachStream(stream, onText)).resolves.toBe("Strong 💪");
    expect(onText).toHaveBeenLastCalledWith("Strong 💪");
  });

  it("returns an empty string for a successful stream with no text", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    await expect(readCoachStream(stream, vi.fn())).resolves.toBe("");
  });

  it("surfaces a stream failure to the caller", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection ended"));
      },
    });

    await expect(readCoachStream(stream, vi.fn())).rejects.toThrow("connection ended");
  });
});
