import { describe, it, expect } from "vitest";
import { isProtectedPath } from "@/lib/supabase/middleware";

describe("isProtectedPath (auth gate)", () => {
  it("does NOT protect the public login page (the /log vs /login loop bug)", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/login?redirect=/log")).toBe(false);
  });

  it("protects each guarded area exactly and its subpaths", () => {
    for (const p of ["/dashboard", "/log", "/scan", "/progress", "/coach", "/onboarding", "/settings"]) {
      expect(isProtectedPath(p)).toBe(true);
      expect(isProtectedPath(p + "/123")).toBe(true);
    }
  });

  it("does not protect paths that merely share a prefix string", () => {
    expect(isProtectedPath("/logout")).toBe(false);
    expect(isProtectedPath("/scanner")).toBe(false);
    expect(isProtectedPath("/progressive")).toBe(false);
    expect(isProtectedPath("/coaching")).toBe(false);
  });

  it("leaves the public routes open", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/demo")).toBe(false);
    expect(isProtectedPath("/auth/callback")).toBe(false);
  });
});
