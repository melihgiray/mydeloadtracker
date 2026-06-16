import Link from "next/link";
import { Activity, Brain, Dumbbell, Flame, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { buildSampleSets, buildSampleCheckins, sampleBodyweight, SAMPLE_SEX } from "@/lib/analytics/sample";
import type { Units } from "@/lib/types";
import { detectDeload } from "@/lib/analytics/deload";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildVolumeReport } from "@/lib/analytics/volume";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { buildRecords } from "@/lib/analytics/records";
import { buildProgressReport } from "@/lib/analytics/progress";
import { buildNextSessions } from "@/lib/analytics/progression";
import { isStandardLift } from "@/lib/analytics/standards";
import { localDateKey } from "@/lib/analytics/dates";
import { buildTodaysCall } from "@/lib/ui";
import { TodaysCall } from "@/components/todays-call";
import { DeloadAlert } from "@/components/deload-alert";
import { ReadinessGauge } from "@/components/readiness-gauge";
import { VolumeChart } from "@/components/volume-chart";
import { SetVolumePanel } from "@/components/set-volume";
import { NextSessionCard } from "@/components/next-session";
import { RecordsTable } from "@/components/records-table";
import { StrengthStandards } from "@/components/strength-standards";
import { TrackOnMount } from "@/components/analytics";

export const dynamic = "force-dynamic";

// A realistic sample of what the live AI coach would say — numbers in the
// viewer's chosen unit so it reads natively for lb or kg lifters.
function coachText(units: Units): string {
  const w = (kg: number) => (units === "lb" ? `${Math.round((kg * 2.20462) / 5) * 5}lb` : `${kg}kg`);
  const incTxt =
    units === "lb" ? "5lb to squat/dead and 2.5lb to bench/press" : "2.5kg to squat/dead and 1kg to bench/press";
  return `You've earned a deload, and the data is unanimous. Three majors, squat (${w(117.5)}), bench (${w(78)}), and overhead press (${w(50)}), haven't moved in 3+ weeks while RPE climbed to 9 and 9.5. Your HRV is down about 21% and resting HR is up about 7 bpm vs baseline, and you dropped from 4 to 2 sessions this week. That's accumulated fatigue masking strength, not a strength ceiling.

**This week, deload:**
- Keep the lifts, cut volume about half: 2 sets instead of 3 to 4.
- Drop intensity to about RPE 6: squat ~${w(95)}, bench ~${w(65)} for your 5s.
- Sleep is your lever. The HRV dip tracks your 2/5 sleep scores.

**Next week, resume:** retest at last week's top weights. Expect them to feel about 1 to 2 RPE easier, that's the supercompensation. Then add ${incTxt} and rebuild.`;
}

export default function DemoPage({ searchParams }: { searchParams: { units?: string } }) {
  // Default to lb for the (US-heavy) launch audience; ?units=kg flips it.
  const units: Units = searchParams?.units === "kg" ? "kg" : "lb";
  const bodyweight = sampleBodyweight(units);

  const now = new Date();
  const sets = buildSampleSets(now, units);
  const checkins = buildSampleCheckins(now);

  const opts = { bodyweight, sex: SAMPLE_SEX };
  const deload = detectDeload(sets, now);
  const readiness = computeReadiness(sets, checkins, now, opts);
  const call = buildTodaysCall(readiness, deload);

  // Honest readiness trend, re-scored as-of each weekly point on the sample data.
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

  const volume = buildVolumeReport(sets, 8, now);
  const setVolume = buildSetVolume(sets, 4, 8, now);
  const records = buildRecords(sets);
  const progress = buildProgressReport(sets, 4, now);
  const nextSessions = buildNextSessions(sets, { units, deload: deload.recommended });

  const tonnageTrend = {
    muscleGroups: ["Total"],
    rows: volume.rows.map((r) => ({ label: r.label, Total: r.total })),
  };
  const standardLifts = records
    .filter((r) => isStandardLift(r.exerciseName))
    .map((r) => ({ name: r.exerciseName, e1rm: r.bestE1RM }));

  const totalVolume = volume.rows.reduce((a, r) => a + r.total, 0);
  const progressing = progress.filter((p) => p.status === "progressing").length;
  const stalls = progress.filter((p) => p.status === "plateauing" || p.status === "regressing").length;
  const stats = [
    { label: "8-week tonnage", value: Math.round(totalVolume).toLocaleString(), unit: units, icon: Flame },
    { label: "Lifts progressing", value: String(progressing), unit: "", icon: TrendingUp },
    { label: "Stalled lifts", value: String(stalls), unit: "", icon: Dumbbell },
    { label: "Personal records", value: String(records.length), unit: "", icon: Trophy },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <TrackOnMount event="demo_viewed" />
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-display font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-foreground">
            <Activity className="h-5 w-5" />
          </span>
          MyDeloadTracker
        </Link>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
            <Link
              href="/demo?units=lb"
              className={`rounded px-2.5 py-1 ${units === "lb" ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"}`}
            >
              lb
            </Link>
            <Link
              href="/demo?units=kg"
              className={`rounded px-2.5 py-1 ${units === "kg" ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"}`}
            >
              kg
            </Link>
          </div>
          <Link href="/login" className="btn-ghost max-sm:hidden">
            Sign in
          </Link>
          <Link href="/login" className="btn-brand">
            Track your own, free
          </Link>
        </div>
      </header>

      {/* Demo banner */}
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-brand/30 bg-brand/10 p-4">
        <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand" />
        <div>
          <h1 className="font-semibold">Live demo, a sample 8-week athlete</h1>
          <p className="text-sm text-muted">
            Everything below is computed by the real engine from a sample lifter&apos;s logs. This
            one is overreached, so watch the app catch it. Sign up to track your own training.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <TodaysCall
          score={readiness.score}
          verdict={call.verdict}
          headline={call.headline}
          detail={call.detail}
          tone={call.tone}
          trend={readinessTrend}
          primaryHref="/login"
          primaryLabel="Track your own, free"
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
            Concrete targets from the last numbers and RPE. This athlete is in a deload, so everything backs off.
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
              Hard sets, the fair way to compare muscles, unlike tonnage where heavy lifts dominate.
            </p>
            <VolumeChart report={setVolume} unit="sets" />
          </div>
          <div className="card lg:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">Total workload</h2>
              <span className="micro">tonnage / wk</span>
            </div>
            <p className="mb-4 text-xs text-muted">Your own work trend over time, not a muscle comparison.</p>
            <VolumeChart report={tonnageTrend} unit={units} showLegend={false} height={240} />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card lg:col-span-3">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">Muscles vs the growth target</h2>
              <span className="micro">avg, last 4 weeks</span>
            </div>
            <p className="mb-4 text-xs text-muted">
              Research favors about 10 to 20 hard sets per muscle each week. The shaded band marks that range.
            </p>
            <SetVolumePanel report={setVolume} />
          </div>
          <div className="lg:col-span-2">
            <StrengthStandards
              lifts={standardLifts}
              units={units}
              initialBodyweight={bodyweight}
              initialSex={SAMPLE_SEX}
            />
          </div>
        </div>

        {/* Sample AI coach */}
        <div className="card">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand/15 text-brand">
              <Brain className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">AI coach</h2>
              <p className="text-xs text-muted">Sample answer to &ldquo;Should I deload?&rdquo;, grounded in this athlete&apos;s numbers.</p>
            </div>
          </div>
          <div className="whitespace-pre-wrap rounded-xl bg-background/60 p-4 text-sm leading-relaxed">
            {coachText(units)}
          </div>
          <Link href="/login" className="btn-accent mt-4">
            Chat with the live coach, free
          </Link>
        </div>

        {/* Records */}
        <div className="card">
          <h2 className="mb-4 font-semibold">Personal records</h2>
          <RecordsTable records={records} units={units} />
        </div>

        {/* Bottom CTA */}
        <div className="panel p-8 text-center">
          <h2 className="text-xl font-semibold">Track your own training</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Log your lifts and get your own deload alerts, readiness score, strength standards, and an
            AI coach, free.
          </p>
          <Link href="/login" className="btn-brand mt-5 w-full sm:w-auto sm:px-8">
            Get started
          </Link>
        </div>
      </div>
    </main>
  );
}
