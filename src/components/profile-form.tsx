"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fromKg, toKg } from "@/lib/units";
import type { Profile, Sex, Units } from "@/lib/types";

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [units, setUnits] = useState<Units>(profile?.units ?? "kg");
  // profile.bodyweight arrives already converted to display units (see data.ts).
  const [bodyweight, setBodyweight] = useState(
    profile?.bodyweight != null ? String(profile.bodyweight) : "",
  );
  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching units must convert the number already on screen, or a later save
  // would write the same figure under a new unit and silently corrupt the stored
  // (canonical kg) bodyweight.
  function changeUnits(next: Units) {
    if (next === units) return;
    const bw = Number(bodyweight);
    if (bodyweight.trim() !== "" && bw > 0) {
      setBodyweight(String(Math.round(fromKg(toKg(bw, units), next) * 10) / 10));
    }
    setUnits(next);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    // Bodyweight is optional here (a name-only change should save), but if it is
    // present it must be valid, because standards and readiness read it.
    const bwRaw = bodyweight.trim();
    const bw = Number(bwRaw);
    if (bwRaw !== "" && !(bw > 0)) {
      setSaving(false);
      setError("Enter a bodyweight greater than zero, or leave it blank.");
      return;
    }

    const update: {
      full_name: string | null;
      units: Units;
      bodyweight?: number;
      sex?: Sex;
    } = { full_name: fullName || null, units };
    // Stored canonically in kg, converted from the unit shown, exactly as
    // onboarding writes it. Left untouched when blank so it is never wiped.
    if (bwRaw !== "") update.bodyweight = toKg(bw, units);
    if (sex) update.sex = sex;

    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
      if (error) throw error;
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card max-w-lg">
      <div className="space-y-5">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setSaved(false);
            }}
            placeholder="Alex Lifter"
          />
        </div>

        <div>
          <label className="label">Bodyweight ({units})</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            className="input max-w-40"
            placeholder={units === "kg" ? "80" : "176"}
            value={bodyweight}
            onChange={(e) => {
              setBodyweight(e.target.value);
              setSaved(false);
            }}
          />
          <p className="mt-2 text-xs text-muted">
            Used for your strength standards and readiness. Update it as it changes.
          </p>
        </div>

        <div>
          <label className="label">Sex</label>
          <div className="inline-flex rounded-xl border border-border p-1">
            {(["male", "female"] as Sex[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSex(s);
                  setSaved(false);
                }}
                className={`rounded-lg px-5 py-1.5 text-sm font-medium capitalize transition-colors ${
                  sex === s ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Sets the strength-standard bands.</p>
        </div>

        <div>
          <label className="label">Weight units</label>
          <div className="inline-flex rounded-xl border border-border p-1">
            {(["kg", "lb"] as Units[]).map((u) => (
              <button
                key={u}
                onClick={() => changeUnits(u)}
                className={`rounded-lg px-5 py-1.5 text-sm font-medium transition-colors ${
                  units === u
                    ? "bg-brand text-brand-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Switch any time. Your weights convert automatically, so everything you have
            logged stays correct in either unit.
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="btn-brand px-6">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save settings
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
