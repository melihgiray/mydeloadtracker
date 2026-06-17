import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { localDateKey } from "@/lib/analytics/dates";
import { detectDeload } from "@/lib/analytics/deload";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildNextSessions } from "@/lib/analytics/progression";
import { buildTodaysCall } from "@/lib/ui";
import { TodaysCall } from "@/components/todays-call";
import { DeloadAlert } from "@/components/deload-alert";
import { ReadinessGauge } from "@/components/readiness-gauge";
import { NextSessionCard } from "@/components/next-session";
import { IconBadge } from "@/components/icon-badge";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const supabase = createClient();
  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";
  const [sets, checkins] = await Promise.all([
    getTrainingSets(supabase, units, 8),
    getCheckins(supabase, 30),
  ]);

  if (sets.length === 0) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="card max-w-sm text-center">
          <h1 className="text-lg font-semibold">Nothing to break down yet</h1>
          <p className="mt-2 text-sm text-muted">Log a session and your readiness picture appears here.</p>
          <Link href="/log" className="btn-brand mt-5 w-full sm:w-auto sm:px-6">
            Log a workout
          </Link>
        </div>
      </div>
    );
  }

  const opts = { bodyweight: profile?.bodyweight ?? null, sex: profile?.sex ?? null };
  const deload = detectDeload(sets);
  const readiness = computeReadiness(sets, checkins, new Date(), opts);
  const call = buildTodaysCall(readiness, deload);
  const nextSessions = buildNextSessions(sets, { units, deload: deload.recommended });

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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground md:hidden"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-semibold">Today&apos;s breakdown</h1>
      </div>

      <TodaysCall
        score={readiness.score}
        verdict={call.verdict}
        headline={call.headline}
        detail={call.detail}
        tone={call.tone}
        trend={readinessTrend}
        primaryHref="/log"
        primaryLabel="Log today's session"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DeloadAlert report={deload} />
        <ReadinessGauge report={readiness} />
      </div>

      <div className="card">
        <div className="mb-1 flex items-center gap-2.5">
          <IconBadge icon={TrendingUp} color="blue" size="sm" />
          <h2 className="font-semibold">Your next session</h2>
          <span className="micro ml-auto">auto-progression</span>
        </div>
        <p className="mb-4 text-xs text-muted">
          Targets from your last numbers and RPE.{" "}
          {deload.recommended ? "Deload week, so everything backs off." : "Earn load when it feels easy."}
        </p>
        <NextSessionCard sessions={nextSessions} units={units} />
      </div>
    </div>
  );
}
