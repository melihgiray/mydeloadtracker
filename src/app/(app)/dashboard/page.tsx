import Link from "next/link";
import { Dumbbell, Flame, TrendingUp, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { todayKey } from "@/lib/analytics/dates";
import { detectDeload } from "@/lib/analytics/deload";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildVolumeReport } from "@/lib/analytics/volume";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { buildRecords } from "@/lib/analytics/records";
import { buildProgressReport } from "@/lib/analytics/progress";
import { DeloadAlert } from "@/components/deload-alert";
import { ReadinessGauge } from "@/components/readiness-gauge";
import { VolumeChart } from "@/components/volume-chart";
import { SetVolumePanel } from "@/components/set-volume";
import { RecordsTable } from "@/components/records-table";
import { CheckinCard } from "@/components/checkin-card";
import { SeedButton } from "@/components/seed-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const [sets, profile, checkins] = await Promise.all([
    getTrainingSets(supabase, 8),
    getProfile(supabase),
    getCheckins(supabase, 30),
  ]);
  const units = profile?.units ?? "kg";
  const todayStr = todayKey();
  const todayCheckin = checkins.find((c) => c.date === todayStr) ?? null;

  if (sets.length === 0) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="card max-w-md text-center">
          <Dumbbell className="mx-auto mb-3 h-8 w-8 text-brand" />
          <h1 className="text-xl font-semibold">No training logged yet</h1>
          <p className="mt-2 text-sm text-muted">
            Log your first session, or load some demo data to explore progressive-overload
            tracking, the deload detector, and the AI coach.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <SeedButton />
            <Link href="/log" className="text-sm text-muted hover:text-foreground">
              or log a workout manually →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const deload = detectDeload(sets);
  const readiness = computeReadiness(sets, checkins, new Date(), {
    bodyweight: profile?.bodyweight ?? null,
    sex: profile?.sex ?? null,
  });
  const volume = buildVolumeReport(sets, 8);
  const setVolume = buildSetVolume(sets, 4, 8);

  // Tonnage as a single total-per-week series. This is tonnage's honest use —
  // tracking your own total work over time — NOT a cross-muscle comparison,
  // where heavy lifts (back/legs) always dwarf small muscles (biceps) and
  // misrepresent how balanced your training actually is.
  const tonnageTrend = {
    muscleGroups: ["Total"],
    rows: volume.rows.map((r) => ({ label: r.label, Total: r.total })),
  };
  const records = buildRecords(sets);
  const progress = buildProgressReport(sets, 4);

  const totalVolume = volume.rows.reduce((a, r) => a + r.total, 0);
  const progressing = progress.filter((p) => p.status === "progressing").length;
  const stalls = progress.filter(
    (p) => p.status === "plateauing" || p.status === "regressing",
  ).length;

  const stats = [
    { label: "8-week volume", value: Math.round(totalVolume).toLocaleString(), unit: units, icon: Flame },
    { label: "Lifts progressing", value: String(progressing), unit: "", icon: TrendingUp },
    { label: "Stalled lifts", value: String(stalls), unit: "", icon: Dumbbell },
    { label: "Personal records", value: String(records.length), unit: "", icon: Trophy },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">
            {profile?.full_name ? `${profile.full_name}'s training` : "Your training"} at a glance.
          </p>
        </div>
        <Link href="/log" className="btn-brand max-sm:hidden">
          <Dumbbell className="h-4 w-4" />
          Log workout
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DeloadAlert report={deload} />
        <ReadinessGauge report={readiness} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <s.icon className="mb-3 h-5 w-5 text-brand" />
            <div className="text-2xl font-semibold tabular-nums">
              {s.value}
              {s.unit && <span className="ml-1 text-sm font-normal text-muted">{s.unit}</span>}
            </div>
            <div className="text-sm text-muted">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Weekly sets by muscle group</h2>
            <span className="text-xs text-muted">last 8 weeks</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Hard sets — the fair way to compare muscles. 10 back sets ≈ 10 biceps sets in stimulus,
            even though back moves far heavier loads.
          </p>
          <VolumeChart report={setVolume} unit="sets" />
        </div>

        <div className="lg:col-span-2">
          <CheckinCard today={todayCheckin} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Muscles vs the growth target</h2>
            <span className="text-xs text-muted">avg, last 4 weeks</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Research favors ~10–20 hard sets/muscle/week. The shaded band marks that range, so you
            can see at a glance which muscles are under- or over-trained.
          </p>
          <SetVolumePanel report={setVolume} />
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Total workload</h2>
            <span className="text-xs text-muted">tonnage/wk</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Σ weight × reps across all lifts. Use this to track your own progressive overload over
            time — not to compare muscles.
          </p>
          <VolumeChart report={tonnageTrend} unit={units} showLegend={false} height={240} />
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Personal records</h2>
          <Link href="/progress" className="text-xs text-brand hover:underline">
            View progress →
          </Link>
        </div>
        <RecordsTable records={records} units={units} />
      </div>
    </div>
  );
}
