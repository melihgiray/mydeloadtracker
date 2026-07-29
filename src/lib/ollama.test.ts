import { describe, it, expect, afterEach } from "vitest";
import { ollamaChat, ollamaTextChunks } from "@/lib/ollama";

// The cloud fallback only works if a failed local call REJECTS, promptly and
// for every reason the Mac can be unavailable. These tests exercise the real
// code path against a closed port rather than a mock, because the thing worth
// proving is that fetch's behaviour is what the routes assume.

afterEach(() => {
  delete process.env.OLLAMA_BASE_URL;
});

describe("ollamaChat failure modes", () => {
  it("rejects when nothing is listening, which is the Mac-asleep case", async () => {
    // Port 1 is reserved and never has a listener.
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";
    await expect(ollamaChat({ model: "x", messages: [] }, 5_000)).rejects.toThrow();
  });

  it("rejects fast, so the fallback is not itself a timeout", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";
    const started = Date.now();
    await expect(ollamaChat({ model: "x", messages: [] }, 5_000)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("honours the timeout when a host accepts but never answers", async () => {
    // Reserved-for-documentation address: routable in form, never responsive.
    process.env.OLLAMA_BASE_URL = "http://192.0.2.1:11434";
    const started = Date.now();
    await expect(ollamaChat({ model: "x", messages: [] }, 700)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("ollamaTextChunks", () => {
  const streamOf = (body: string): Response =>
    new Response(new Blob([body]).stream() as ReadableStream<Uint8Array>);

  const collect = async (body: string): Promise<string[]> => {
    const out: string[] = [];
    for await (const t of ollamaTextChunks(streamOf(body))) out.push(t);
    return out;
  };

  it("yields the text of each newline-delimited chunk", async () => {
    const body =
      '{"message":{"content":"Your squat "}}\n' + '{"message":{"content":"is trending up."}}\n';
    expect((await collect(body)).join("")).toBe("Your squat is trending up.");
  });

  it("emits a final chunk with no trailing newline, so the last word is not lost", async () => {
    const body = '{"message":{"content":"a"}}\n{"message":{"content":"b"}}';
    expect((await collect(body)).join("")).toBe("ab");
  });

  it("skips chunks carrying no text rather than emitting undefined", async () => {
    const body = '{"message":{"content":"a"}}\n{"done":true}\n{"message":{}}\n';
    expect((await collect(body)).join("")).toBe("a");
  });

  it("throws when the response has no body, instead of hanging", async () => {
    const res = new Response(null);
    await expect(async () => {
      for await (const _ of ollamaTextChunks(res)) void _;
    }).rejects.toThrow();
  });
});
