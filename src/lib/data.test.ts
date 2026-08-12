import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getCheckins, getProfile, getSessionsWithSets, getTrainingSets } from "@/lib/data";

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

// The read seam: stored weights are canonical kg and must be converted to the
// athlete's display unit. These lock that conversion so it can't be dropped.
function trainingSetsClient(result: { data: unknown; error: unknown }): SupabaseClient {
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

function sessionsClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => result,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

// numeric columns arrive as strings over PostgREST, hence the string weight.
const setRow = (weightKg: string) => ({
  reps: 5,
  weight: weightKg,
  rpe: 8,
  set_number: 1,
  workout_sessions: { id: "s1", performed_at: "2026-06-01T12:00:00.000Z" },
  exercises: { id: "e1", name: "Bench Press", muscle_group: "Chest", is_major: true },
});

describe("getTrainingSets unit conversion (read seam)", () => {
  it("converts canonical kg set weights into the display unit (lb)", async () => {
    const sets = await getTrainingSets(trainingSetsClient({ data: [setRow("100")], error: null }), "lb");
    expect(sets).toHaveLength(1);
    expect(sets[0].weight).toBe(220.46);
  });

  it("leaves kilogram weights untouched for a kg athlete", async () => {
    const sets = await getTrainingSets(trainingSetsClient({ data: [setRow("102.5")], error: null }), "kg");
    expect(sets[0].weight).toBe(102.5);
  });
});

describe("getSessionsWithSets unit conversion (history/edit read seam)", () => {
  it("converts each stored set weight into the display unit (lb)", async () => {
    const data = [
      {
        id: "sess1",
        performed_at: "2026-06-01T12:00:00.000Z",
        notes: null,
        workout_sets: [
          {
            id: "x1",
            reps: 5,
            weight: "100",
            rpe: 8,
            set_number: 1,
            exercises: {
              id: "e1",
              name: "Bench Press",
              muscle_group: "Chest",
              movement_pattern: "Horizontal Push",
              is_major: true,
            },
          },
        ],
      },
    ];
    const sessions = await getSessionsWithSets(sessionsClient({ data, error: null }), "lb");
    expect(sessions[0].sets[0].weight).toBe(220.46);
  });
});
