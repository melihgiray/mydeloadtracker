import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi } from "vitest";
import {
  buildSaveArgs,
  recordWorkoutPlanContext,
  saveWorkoutSession,
} from "@/lib/workout-save";

const sets = [{ exercise_id: "e1", set_number: 1, reps: 5, weight: 100, rpe: 8 }];

describe("buildSaveArgs", () => {
  it("sends a null session id when creating a new workout", () => {
    const args = buildSaveArgs({ performedAt: "2026-06-01T12:00:00Z", notes: "hi", sets });
    expect(args).toEqual({
      p_session_id: null,
      p_performed_at: "2026-06-01T12:00:00Z",
      p_notes: "hi",
      p_sets: sets,
    });
  });

  it("sends the session id when editing", () => {
    const args = buildSaveArgs({ sessionId: "s9", performedAt: "2026-06-01T12:00:00Z", notes: null, sets });
    expect(args.p_session_id).toBe("s9");
  });
});

function rpcClient(result: { data: unknown; error: unknown }, capture?: (name: string, args: unknown) => void): SupabaseClient {
  return {
    rpc: async (name: string, args: unknown) => {
      capture?.(name, args);
      return result;
    },
  } as unknown as SupabaseClient;
}

describe("saveWorkoutSession", () => {
  it("calls the RPC with the built args and returns the session id", async () => {
    let seen: { name: string; args: unknown } | null = null;
    const client = rpcClient({ data: "sess-123", error: null }, (name, args) => (seen = { name, args }));
    const id = await saveWorkoutSession(client, { performedAt: "2026-06-01T12:00:00Z", notes: null, sets });
    expect(id).toBe("sess-123");
    expect(seen!.name).toBe("save_workout_session");
    expect((seen!.args as { p_sets: unknown }).p_sets).toEqual(sets);
  });

  it("throws the database error message (no silent fallback)", async () => {
    const client = rpcClient({ data: null, error: { message: "A performed set is invalid." } });
    await expect(
      saveWorkoutSession(client, { performedAt: "2026-06-01T12:00:00Z", notes: null, sets }),
    ).rejects.toThrow("A performed set is invalid.");
  });

  it("throws when the RPC does not return a session id", async () => {
    const client = rpcClient({ data: null, error: null });
    await expect(
      saveWorkoutSession(client, { performedAt: "2026-06-01T12:00:00Z", notes: null, sets }),
    ).rejects.toThrow("did not return a session id");
  });
});

describe("recordWorkoutPlanContext", () => {
  const context = { planId: "plan-1", planDayId: "day-1", dayIndex: 0, dayName: "Upper A" };
  const snapshot = {
    version: 1 as const,
    dayIndex: 0,
    dayName: "Upper A",
    planned: [],
    substitutions: [],
  };

  it("records the versioned snapshot against the saved session", async () => {
    let seen: { name: string; args: unknown } | null = null;
    const client = rpcClient({ data: true, error: null }, (name, args) => (seen = { name, args }));

    await expect(recordWorkoutPlanContext(client, "session-1", context, snapshot)).resolves.toBe(true);
    expect(seen).toEqual({
      name: "record_workout_plan_context",
      args: {
        p_session_id: "session-1",
        p_plan_id: "plan-1",
        p_plan_day_id: "day-1",
        p_plan_snapshot: snapshot,
      },
    });
  });

  it("keeps saving compatible while migration 0020 is not applied", async () => {
    const client = rpcClient({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    await expect(recordWorkoutPlanContext(client, "session-1", context, snapshot)).resolves.toBe(false);
  });

  it("reports an unexpected linkage failure without retrying the workout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = { code: "42501", message: "not allowed" };
    const client = rpcClient({ data: null, error });

    await expect(recordWorkoutPlanContext(client, "session-1", context, snapshot)).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("Workout plan context save failed:", error);
    errorSpy.mockRestore();
  });
});
