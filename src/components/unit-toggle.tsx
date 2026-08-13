"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Units } from "@/lib/types";

/**
 * Always-visible kg/lb switch. Lives in the app top bar so it is reachable on
 * every screen, including mobile where Settings is off the bottom nav. Writes
 * the preference to the profile and refreshes, which re-renders the server
 * components with every weight converted into the chosen unit.
 */
export function UnitToggle({ initial }: { initial: Units }) {
  const [units, setUnits] = useState<Units>(initial);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function pick(u: Units) {
    if (u === units || saving) return;
    setUnits(u); // optimistic
    setSaving(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error } = await supabase.from("profiles").update({ units: u }).eq("id", user.id);
      if (error) throw error;
    } catch {
      setUnits(initial);
    } finally {
      setSaving(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div
      className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium"
      role="group"
      aria-label="Weight units"
    >
      {(["kg", "lb"] as Units[]).map((u) => (
        <button
          key={u}
          onClick={() => pick(u)}
          disabled={saving}
          aria-pressed={units === u}
          className={`tap rounded-md px-2.5 py-1 transition-colors disabled:opacity-60 ${
            units === u ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
