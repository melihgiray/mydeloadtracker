"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Units } from "@/lib/types";

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [units, setUnits] = useState<Units>(profile?.units ?? "kg");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName || null, units })
        .eq("id", user.id);
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
          <label className="label">Weight units</label>
          <div className="inline-flex rounded-xl border border-border p-1">
            {(["kg", "lb"] as Units[]).map((u) => (
              <button
                key={u}
                onClick={() => {
                  setUnits(u);
                  setSaved(false);
                }}
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
