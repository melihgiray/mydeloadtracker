import { describe, expect, it } from "vitest";
import { parsePersistedValue } from "./use-persistent-state";

describe("parsePersistedValue", () => {
  const now = 2_000;
  const ttl = 1_000;

  it("restores a value that is still fresh", () => {
    const raw = JSON.stringify({ v: { draft: "keep me" }, t: 1_500 });

    expect(parsePersistedValue(raw, { draft: "" }, ttl, now)).toEqual({ draft: "keep me" });
  });

  it("falls back when the stored value has expired", () => {
    const raw = JSON.stringify({ v: "stale", t: 999 });

    expect(parsePersistedValue(raw, "fresh", ttl, now)).toBe("fresh");
  });

  it("falls back for missing or corrupt storage", () => {
    expect(parsePersistedValue(null, ["initial"], ttl, now)).toEqual(["initial"]);
    expect(parsePersistedValue("not json", ["initial"], ttl, now)).toEqual(["initial"]);
  });
});
