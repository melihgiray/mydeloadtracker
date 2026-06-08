import Link from "next/link";
import { Activity, Brain, Dumbbell, Flame, Sparkles, TrendingUp, Trophy } from "lucide-react";
import {
  buildSampleSets,
  buildSampleCheckins,
  SAMPLE_BODYWEIGHT,
  SAMPLE_SEX,
  SAMPLE_UNITS,
} from "@/lib/analytics/sample";
import { detectDeload } from "@/lib/analytics/deload";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildVolumeReport } from "@/lib/analytics/volume";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { buildRecords } from "@/lib/analytics/records";
import { buildProgressReport } from "@/lib/analytics/progress";
import { isStandardLift } from "@/lib/analytics/standards";
import { DeloadAlert } from "@/components/deload-alert";
import { ReadinessGauge } from "@/components/readiness-gauge";
import { VolumeChart } from "@/components/volume-chart";
import { SetVolumePanel } from "@/components/set-volume";
import { RecordsTable } from "@/components/records-table";
import { StrengthStandards } from "@/components/strength-standards";

export const dynamic = "force-dynamic";

// A realistic sample of what the live AI coach would say for this athlete.
const SAMPLE_COACH = `You've earned a deload, and the data is unanimous. Three majors — squat (117.5kg), bench (78kg), and overhead press (50kg) — haven't moved in 3+ weeks while RPE climbed to 9–9.5. Your HRV is down ~21% and resting HR is up ~7 bpm vs baseline, and you dropped from 4 to 2 sessions this week. That's accumulated fatigue masking strength, not a strength ceiling.

**This week — deload:**
- Keep the lifts, cut volume ~50%: 2 sets instead of 3–4.
- Drop intensity to ~RPE 6: squat ~95kg, bench ~65kg for your 5s.
- Sleep is your lever — the HRV dip tracks your 2/5 sleep scores.

**Next week — resume:** retest at last week's top weights. Expect them to feel ~1–2 RPE easier; that's the supercompensation. Then add 2.5kg to squat/dead and 1kg to bench/press and rebuild.`;

export default function DemoPage() {
  const now = new Date();
  const sets = buildSampleSets(now);
  const checkins = buildSampleCheckins(now);

  const deload = detectDeload(sets, now);
  const readiness = computeReadiness(sets, checkins, now, {
    bodyweight: SAMPLE_BODYWEIGHT,
    sex: SAMPLE_SEX,
  });
  const volume = buildVolumeReport(sets, 8, now);
  const setVolume = buildSetVolume(sets, 4, 8, now);
  const records = buildRecords(sets);
  const progress = buildProgressReport(sets, 4, now);

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
    { label: "8-week tonnage", value: Math.round(totalVolume).toLocaleString(), unit: SAMPLE_UNITS, icon: Flame },
    { label: "Lifts progressing", value: String(progressing), unit: "", icon: TrendingUp },
    { label: "Stalled lifts", value: String(stalls), unit: "", icon: Dumbbell },
    { label: "Personal records", value: String(records.length), unit: "", icon: Trophy },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-foreground">
            <Activity className="h-5 w-5" />
          </span>
          MyDeloadTracker
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link href="/login" className="btn-brand">
            Track your own — free
          </Link>
        </div>
      </header>

      {/* Demo banner */}
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-brand/30 bg-brand/10 p-4">
        <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand" />
        <div>
          <h1 className="font-semibold">Live demo — a sample 8-week athlete</h1>
          <p className="text-sm text-muted">
            Everything below is computed by the real engine from a sample lifter&apos;s logs. This
            one is overreached — see how the app catches it. Sign up to track your own training.
          </p>
        </div>
      </div>

      <div className="space-y-6">
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
              Hard sets — the fair way to compare muscles, unlike tonnage where heavy lifts dominate.
            </p>
            <VolumeChart report={setVolume} unit="sets" />
          </div>
          <div className="card lg:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">Total workload</h2>
              <span className="text-xs text-muted">tonnage/wk</span>
            </div>
            <p className="mb-4 text-xs text-muted">Your own work trend over time — not a muscle comparison.</p>
            <VolumeChart report={tonnageTrend} unit={SAMPLE_UNITS} showLegend={false} height={240} />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card lg:col-span-3">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">Muscles vs the growth target</h2>
              <span className="text-xs text-muted">avg, last 4 weeks</span>
            </div>
            <p className="mb-4 text-xs text-muted">
              Research favors ~10–20 hard sets/muscle/week. The shaded band marks that range.
            </p>
            <SetVolumePanel report={setVolume} />
          </div>
          <div className="lg:col-span-2">
            <StrengthStandards
              lifts={standardLifts}
              units={SAMPLE_UNITS}
              initialBodyweight={SAMPLE_BODYWEIGHT}
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
              <p className="text-xs text-muted">Sample answer to “Should I deload?” — grounded in this athlete&apos;s numbers.</p>
            </div>
          </div>
          <div className="whitespace-pre-wrap rounded-xl bg-background/60 p-4 text-sm leading-relaxed">
            {SAMPLE_COACH}
          </div>
          <Link href="/login" className="btn-brand mt-4">
            Chat with the live coach — free
          </Link>
        </div>

        {/* Records */}
        <div className="card">
          <h2 className="mb-4 font-semibold">Personal records</h2>
          <RecordsTable records={records} units={SAMPLE_UNITS} />
        </div>

        {/* Bottom CTA */}
        <div className="rounded-2xl border border-border bg-surface/60 p-8 text-center">
          <h2 className="text-xl font-semibold">Track your own training</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Log your lifts and get your own deload alerts, readiness score, strength standards, and
            AI coach — free.
          </p>
          <Link href="/login" className="btn-brand mt-5 px-6 py-2.5">
            Get started
          </Link>
        </div>
      </div>
    </main>
  );
}
