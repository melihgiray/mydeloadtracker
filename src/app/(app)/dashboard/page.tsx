import Link from "next/link";
import { Dumbbell, Flame, ScanLine, TrendingUp, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { todayKey, localDateKey } from "@/lib/analytics/dates";
import { detectDeload } from "@/lib/analytics/deload";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildVolumeReport } from "@/lib/analytics/volume";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { buildRecords } from "@/lib/analytics/records";
import { buildProgressReport } from "@/lib/analytics/progress";
import { buildNextSessions } from "@/lib/analytics/progression";
import { buildTodaysCall } from "@/lib/ui";
import { TodaysCall } from "@/components/todays-call";
import { DeloadAlert } from "@/components/deload-alert";
import { ReadinessGauge } from "@/components/readiness-gauge";
import { VolumeChart } from "@/components/volume-chart";
import { SetVolumePanel } from "@/components/set-volume";
import { NextSessionCard } from "@/components/next-session";
import { RecordsTable } from "@/components/records-table";
import { CheckinCard } from "@/components/checkin-card";
import { SeedButton } from "@/components/seed-button";
import { TrackOnMount } from "@/components/analytics";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";
  const [sets, checkins] = await Promise.all([
    getTrainingSets(supabase, units, 8),
    getCheckins(supabase, 30),
  ]);
  const todayStr = todayKey();
  const todayCheckin = checkins.find((c) => c.date === todayStr) ?? null;

  if (sets.length === 0) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="panel max-w-md text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand/15 text-brand">
            <Dumbbell className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold">Let&apos;s get your first reading</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Tell us your main lifts and your numbers. In about a minute you&apos;ll have a strength
            rank, a readiness score, and your first next-session target.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Link href="/onboarding" className="btn-brand w-full sm:w-auto sm:px-8">
              Set up in 60 seconds
            </Link>
            <div className="flex items-center gap-2 text-sm text-muted">
              <SeedButton />
              <span aria-hidden>·</span>
              <Link href="/log" className="underline-offset-2 hover:text-foreground hover:underline">
                or log a workout manually
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const opts = { bodyweight: profile?.bodyweight ?? null, sex: profile?.sex ?? null };
  const deload = detectDeload(sets);
  const readiness = computeReadiness(sets, checkins, new Date(), opts);
  const call = buildTodaysCall(readiness, deload);

  // Honest readiness trend for the pulse: re-score the model as-of each of the
  // last 8 weekly points, feeding it ONLY the data that existed by that date so
  // it never leaks future sets. Uses the existing pure function, unchanged.
  const now = new Date();
  const readinessTrend: number[] = [];
  for (let i = 7; i >= 0; i--) {
    const asOf = new Date(now);
    asOf.setDate(asOf.getDate() - i * 7);
    const asOfIso = asOf.toISOString();
    const sUpTo = sets.filter((s) => s.date <= asOfIso);
    if (sUpTo.length === 0) continue;
    const cUpTo = checkins.filter((c) => c.date <= localDateKey(asOf));
    readinessTrend.push(computeReadiness(sUpTo, cUpTo, asOf, opts).score);
  }
  if (readinessTrend.length === 0) readinessTrend.push(readiness.score);

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
  const nextSessions = buildNextSessions(sets, { units, deload: deload.recommended });

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

  const primary = call.state === "back-off"
    ? { href: "/coach", label: "Plan my deload week" }
    : { href: "/log", label: "Log today's session" };

  return (
    <div className="space-y-5">
      <TrackOnMount event="next_session_viewed" />
      {deload.recommended && <TrackOnMount event="deload_alert_shown" />}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {profile?.full_name ? `${profile.full_name.split(" ")[0]}, here` : "Here"} is your read for today.
        </p>
        <div className="flex gap-2 max-sm:hidden">
          <Link href="/scan" className="btn-ghost">
            <ScanLine className="h-4 w-4" />
            Scan the bar
          </Link>
          <Link href="/log" className="btn-accent">
            <Dumbbell className="h-4 w-4" />
            Log workout
          </Link>
        </div>
      </div>

      <TodaysCall
        score={readiness.score}
        verdict={call.verdict}
        headline={call.headline}
        detail={call.detail}
        tone={call.tone}
        trend={readinessTrend}
        primaryHref={primary.href}
        primaryLabel={primary.label}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DeloadAlert report={deload} />
        <ReadinessGauge report={readiness} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="flex items-center justify-between">
              <span className="micro">{s.label}</span>
              <s.icon className="h-4 w-4 text-faint" />
            </div>
            <div className="readout mt-3 text-3xl font-semibold">
              {s.value}
              {s.unit && <span className="ml-1 font-sans text-sm font-normal text-muted">{s.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Your next session</h2>
          <span className="micro">auto-progression</span>
        </div>
        <p className="mb-4 text-xs text-muted">
          Targets from your last numbers and RPE. {deload.recommended ? "Deload week, so everything backs off." : "Earn load when it feels easy, hold and chase reps when it feels hard."}
        </p>
        <NextSessionCard sessions={nextSessions} units={units} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Weekly sets by muscle group</h2>
            <span className="micro">last 8 weeks</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Hard sets, the fair way to compare muscles. 10 back sets count like 10 biceps sets in
            stimulus, even though back moves far heavier loads.
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
            <span className="micro">avg, last 4 weeks</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Research favors about 10 to 20 hard sets per muscle each week. The shaded band marks that
            range, so you can see at a glance which muscles are under or over trained.
          </p>
          <SetVolumePanel report={setVolume} />
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Total workload</h2>
            <span className="micro">tonnage / wk</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Total weight times reps across all lifts. Use this to track your own progressive overload
            over time, not to compare muscles.
          </p>
          <VolumeChart report={tonnageTrend} unit={units} showLegend={false} height={240} />
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Personal records</h2>
          <Link href="/progress" className="text-xs font-medium text-brand hover:underline">
            View progress
          </Link>
        </div>
        <RecordsTable records={records} units={units} />
      </div>
    </div>
  );
}
