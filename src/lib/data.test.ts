import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getCheckins, getProfile } from "@/lib/data";

function profileClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        single: async () => result,
      }),
    }),
  } as unknown as SupabaseClient;
}

function checkinClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        gte: () => ({
          order: async () => result,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("getProfile error semantics", () => {
  it("returns null only when the profile row genuinely does not exist", async () => {
    await expect(
      getProfile(profileClient({ data: null, error: { code: "PGRST116" } })),
    ).resolves.toBeNull();
  });

  it("does not reinterpret a failed profile read as an empty profile", async () => {
    const error = { code: "PGRST000", message: "database unavailable" };
    await expect(getProfile(profileClient({ data: null, error }))).rejects.toBe(error);
  });

  it("converts canonical bodyweight into the profile display unit", async () => {
    const profile = await getProfile(
      profileClient({
        data: { id: "u1", units: "lb", bodyweight: 100 },
        error: null,
      }),
    );
    expect(profile?.bodyweight).toBe(220.46);
  });
});

describe("getCheckins error semantics", () => {
  it("allows the optional check-in table to be genuinely absent", async () => {
    await expect(
      getCheckins(checkinClient({ data: null, error: { code: "PGRST205" } })),
    ).resolves.toEqual([]);
  });

  it("does not reinterpret a failed check-in read as no recovery history", async () => {
    const error = { code: "PGRST000", message: "database unavailable" };
    await expect(getCheckins(checkinClient({ data: null, error }))).rejects.toBe(error);
  });
});
