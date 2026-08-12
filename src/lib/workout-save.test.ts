import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { buildSaveArgs, saveWorkoutSession } from "@/lib/workout-save";

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
