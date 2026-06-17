"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Moon, Battery, HeartPulse, Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { todayKey } from "@/lib/analytics/dates";
import type { DailyCheckin } from "@/lib/types";

type MetricKey = "sleep_quality" | "soreness" | "motivation" | "energy";

const METRICS: { key: MetricKey; label: string; hint: string; icon: typeof Moon }[] = [
  { key: "sleep_quality", label: "Sleep", hint: "1 poor · 5 great", icon: Moon },
  { key: "soreness", label: "Soreness", hint: "1 none · 5 very sore", icon: HeartPulse },
  { key: "motivation", label: "Motivation", hint: "1 low · 5 high", icon: Flame },
  { key: "energy", label: "Energy", hint: "1 drained · 5 fresh", icon: Battery },
];

export function CheckinCard({
  today,
  onSaved,
}: {
  today: DailyCheckin | null;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const todayStr = todayKey();
  const [values, setValues] = useState<Record<MetricKey, number | null>>({
    sleep_quality: today?.sleep_quality ?? null,
    soreness: today?.soreness ?? null,
    motivation: today?.motivation ?? null,
    energy: today?.energy ?? null,
  });
  const [restingHr, setRestingHr] = useState(today?.resting_hr != null ? String(today.resting_hr) : "");
  const [hrv, setHrv] = useState(today?.hrv != null ? String(today.hrv) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: MetricKey, v: number) {
    setValues((prev) => ({ ...prev, [key]: prev[key] === v ? null : v }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase
        .from("daily_checkins")
        .upsert(
          {
            user_id: user.id,
            date: todayStr,
            ...values,
            resting_hr: restingHr === "" ? null : Number(restingHr),
            hrv: hrv === "" ? null : Number(hrv),
          },
          { onConflict: "user_id,date" },
        );
      if (error) throw error;
      setSaved(true);
      router.refresh();
      onSaved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save check-in.";
      setError(
        /relation .* does not exist|could not find the table/i.test(msg)
          ? "Check-ins need migration 0003 applied to your database first."
          : msg,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Today&apos;s check-in</h2>
          <p className="text-xs text-muted">Feeds your readiness score & the coach.</p>
        </div>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      <div className="space-y-3">
        {METRICS.map((m) => (
          <div key={m.key} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <m.icon className="h-4 w-4 text-muted" />
              <div>
                <div className="text-sm font-medium leading-none">{m.label}</div>
                <div className="text-[11px] text-muted">{m.hint}</div>
              </div>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => set(m.key, v)}
                  className={`h-8 w-8 rounded-lg border text-sm tabular-nums transition-colors ${
                    values[m.key] === v
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border bg-background text-muted hover:bg-surface-hover"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">
          From your wearable (optional)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Resting HR (bpm)</label>
            <input
              type="number"
              inputMode="numeric"
              className="input"
              placeholder="54"
              value={restingHr}
              onChange={(e) => {
                setRestingHr(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div>
            <label className="label">HRV (ms)</label>
            <input
              type="number"
              inputMode="numeric"
              className="input"
              placeholder="65"
              value={hrv}
              onChange={(e) => {
                setHrv(e.target.value);
                setSaved(false);
              }}
            />
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button onClick={save} disabled={saving} className="btn-brand mt-4 w-full">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {today ? "Update check-in" : "Save check-in"}
      </button>
    </div>
  );
}
