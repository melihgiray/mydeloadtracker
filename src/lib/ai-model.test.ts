// toUsageReport normalizes the Anthropic SDK usage object before it is sent to
// PostHog for real-cost tracking. Missing or null token fields must become 0,
// never undefined or NaN, or the cost math downstream breaks silently.

import { describe, it, expect } from "vitest";
import { toUsageReport } from "@/lib/ai-model";

describe("toUsageReport", () => {
  it("maps a complete SDK usage object", () => {
    expect(
      toUsageReport("claude-sonnet-4-6", {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 800,
      }),
    ).toEqual({
      model: "claude-sonnet-4-6",
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 5000,
      cacheWriteTokens: 800,
    });
  });

  it("zeroes every token field when usage is null or undefined", () => {
    for (const u of [null, undefined]) {
      expect(toUsageReport("m", u)).toEqual({
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    }
  });

  it("treats missing or null cache fields as 0, keeping real counts", () => {
    const r = toUsageReport("m", {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    expect(r).toEqual({
      model: "m",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
