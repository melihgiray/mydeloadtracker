"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { capture } from "@/lib/track";
import { toKg } from "@/lib/units";
import type { Sex, Units } from "@/lib/types";

interface OfferedLift {
  id: string;
  name: string;
  is_major: boolean;
}

interface LiftState {
  selected: boolean;
  weight: string;
  reps: string;
}

export function OnboardingForm({
  exercises,
  initialUnits,
  initialBodyweight,
  initialSex,
}: {
  exercises: OfferedLift[];
  initialUnits: Units;
  initialBodyweight: number | null;
  initialSex: Sex | null;
}) {
  const router = useRouter();
  const [units, setUnits] = useState<Units>(initialUnits);
  const [bodyweight, setBodyweight] = useState(initialBodyweight != null ? String(initialBodyweight) : "");
  const [sex, setSex] = useState<Sex | null>(initialSex);
  const [restingHr, setRestingHr] = useState("");
  const [hrv, setHrv] = useState("");
  const [lifts, setLifts] = useState<Record<string, LiftState>>(() =>
    Object.fromEntries(
      exercises.map((e) => [e.id, { selected: e.is_major, weight: "", reps: "5" }]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLift(id: string, patch: Partial<LiftState>) {
    setLifts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function finish() {
    setError(null);
    const bw = Number(bodyweight);
    if (!sex) return setError("Pick your sex, it's needed for strength standards.");
    if (!(bw > 0)) return setError("Enter your bodyweight.");

    const chosen = exercises
      .filter((e) => lifts[e.id].selected && Number(lifts[e.id].weight) > 0 && Number(lifts[e.id].reps) > 0)
      .map((e) => ({ id: e.id, weight: Number(lifts[e.id].weight), reps: Number(lifts[e.id].reps) }));
    if (chosen.length === 0)
      return setError("Add a working set (weight + reps) for at least one lift.");

    setSaving(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You're not signed in.");

      // 1) Profile (bodyweight stored canonically in kg)
      await supabase
        .from("profiles")
        .update({ units, bodyweight: toKg(bw, units), sex })
        .eq("id", user.id);

      // 2) An initial session with their current working sets, so standards +
      //    next-session targets populate immediately (the aha moment).
      const { data: session, error: sErr } = await supabase
        .from("workout_sessions")
        .insert({ user_id: user.id, performed_at: new Date().toISOString(), notes: "Starting numbers" })
        .select("id")
        .single();
      if (sErr || !session) throw new Error(sErr?.message ?? "Could not save your lifts.");

      const rows = chosen.map((c) => ({
        session_id: session.id,
        exercise_id: c.id,
        user_id: user.id,
        set_number: 1,
        reps: c.reps,
        weight: toKg(c.weight, units),
        rpe: null,
      }));
      const { error: setErr } = await supabase.from("workout_sets").insert(rows);
      if (setErr) throw new Error(setErr.message);

      // 3) Optional morning recovery
      if (Number(restingHr) > 0 || Number(hrv) > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await supabase.from("daily_checkins").upsert(
          {
            user_id: user.id,
            date: today,
            resting_hr: Number(restingHr) > 0 ? Number(restingHr) : null,
            hrv: Number(hrv) > 0 ? Number(hrv) : null,
          },
          { onConflict: "user_id,date" },
        );
      }

      capture("onboarding_completed", { lifts: chosen.length, recovery: Number(hrv) > 0 || Number(restingHr) > 0 });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* About you */}
      <div className="card">
        <h2 className="font-semibold">About you</h2>
        <p className="mb-4 text-xs text-muted">Powers your strength standards and deload timing.</p>
        <div className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="label">Bodyweight ({units})</label>
              <input
                type="number"
                inputMode="decimal"
                className="input"
                placeholder={units === "kg" ? "80" : "176"}
                value={bodyweight}
                onChange={(e) => setBodyweight(e.target.value)}
              />
            </div>
            <div className="inline-flex rounded-xl border border-border p-1">
              {(["kg", "lb"] as Units[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnits(u)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
                    units === u ? "bg-brand text-brand-foreground" : "text-muted"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Sex</label>
            <div className="inline-flex rounded-xl border border-border p-1">
              {(["male", "female"] as Sex[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSex(s)}
                  className={`rounded-lg px-5 py-1.5 text-sm font-medium capitalize ${
                    sex === s ? "bg-brand text-brand-foreground" : "text-muted"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Lifts */}
      <div className="card">
        <h2 className="font-semibold">Your main lifts</h2>
        <p className="mb-4 text-xs text-muted">
          Add a recent working set for each, and we&apos;ll rank it and set your next target.
        </p>
        <div className="space-y-2">
          {exercises.map((e) => {
            const l = lifts[e.id];
            return (
              <div key={e.id} className="rounded-xl border border-border p-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={l.selected}
                    onChange={(ev) => setLift(e.id, { selected: ev.target.checked })}
                    className="h-4 w-4 accent-[hsl(var(--brand))]"
                  />
                  <span className="text-sm font-medium">{e.name}</span>
                </label>
                {l.selected && (
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    <input
                      type="number"
                      inputMode="decimal"
                      className="input"
                      placeholder={`weight (${units})`}
                      value={l.weight}
                      onChange={(ev) => setLift(e.id, { weight: ev.target.value })}
                    />
                    <span className="text-muted">×</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="input w-20"
                      placeholder="reps"
                      value={l.reps}
                      onChange={(ev) => setLift(e.id, { reps: ev.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional recovery */}
      <div className="card">
        <h2 className="font-semibold">This morning&apos;s recovery <span className="text-xs font-normal text-muted">(optional)</span></h2>
        <p className="mb-4 text-xs text-muted">From a wearable, if you have one. You can connect Oura later for auto-sync.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Resting HR (bpm)</label>
            <input type="number" inputMode="numeric" className="input" placeholder="54" value={restingHr} onChange={(e) => setRestingHr(e.target.value)} />
          </div>
          <div>
            <label className="label">HRV (ms)</label>
            <input type="number" inputMode="numeric" className="input" placeholder="65" value={hrv} onChange={(e) => setHrv(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button onClick={finish} disabled={saving} className="btn-brand w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Finish setup and see my plan
      </button>
    </div>
  );
}
