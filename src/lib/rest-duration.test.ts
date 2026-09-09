import { describe, expect, it } from "vitest";
import {
  isValidRestDuration,
  plannedRestDuration,
  resolveRestDuration,
} from "@/lib/rest-duration";

describe("plannedRestDuration", () => {
  it("prefers an explicit plan prescription", () => {
    expect(plannedRestDuration({ restSeconds: 150, role: "primary" })).toBe(150);
  });

  it("uses the plan role defaults when rest is omitted", () => {
    expect(plannedRestDuration({ restSeconds: null, role: "primary" })).toBe(180);
    expect(plannedRestDuration({ restSeconds: null, role: "secondary" })).toBe(120);
    expect(plannedRestDuration({ restSeconds: null, role: "isolation" })).toBe(90);
  });

  it("leaves an unknown or unplanned exercise on the athlete's chosen timer", () => {
    expect(plannedRestDuration({ restSeconds: null, role: null })).toBeNull();
    expect(resolveRestDuration(null, 120)).toBe(120);
  });
});

describe("rest duration validation", () => {
  it("accepts the plan schema range and rejects unsafe timer values", () => {
    expect(isValidRestDuration(15)).toBe(true);
    expect(isValidRestDuration(600)).toBe(true);
    expect(isValidRestDuration(0)).toBe(false);
    expect(isValidRestDuration(601)).toBe(false);
    expect(isValidRestDuration(90.5)).toBe(false);
  });
});
