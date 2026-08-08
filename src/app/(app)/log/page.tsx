import Link from "next/link";
import { CalendarCheck, ScanLine, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getExercises, getProfile, getTrainingSets } from "@/lib/data";
import { getPlanDayForToday, isScheduledDeloadWeek, planCycleWeek } from "@/lib/plans";
import { buildPlannedSession, type PlannedExercise } from "@/lib/plan-session";
import { buildNextSessions } from "@/lib/analytics/progression";
import { detectDeload } from "@/lib/analytics/deload";
import { todayKey } from "@/lib/analytics/dates";
import { LogForm } from "@/components/log-form";
import { CheckinSection } from "@/components/checkin-section";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const supabase = createClient();
  const [exercises, profile, checkins] = await Promise.all([
    getExercises(supabase),
    getProfile(supabase),
    getCheckins(supabase, 2),
  ]);
  const units = profile?.units ?? "kg";
  const todayCheckin = checkins.find((c) => c.date === todayKey()) ?? null;

  // Today's planned session, prefilled from the athlete's own history so that
  // logging is confirming rather than searching and typing. No plan is the
  // normal case until one is generated, and the form falls back to search.
  // Both calls are tolerant: a planner failure must never break logging, which
  // is the one thing in this app that has to work every time.
  const [today, sets] = await Promise.all([
    getPlanDayForToday(supabase).catch(() => null),
    getTrainingSets(supabase, units, 8).catch(() => []),
  ]);

  let planned: PlannedExercise[] | undefined;
  let deloadMessage: string | null = null;
  if (today) {
    // A scheduled deload and an earlier readiness-triggered deload are equally
    // actionable. Either one adapts today's plan. Readiness can pull recovery
    // forward, while the explicit plan week prevents an accumulation block
    // from running forever when the fatigue detector stays quiet.
    const readinessDeload = detectDeload(sets).recommended;
    const dateKey = todayKey();
    const scheduledDeload = isScheduledDeloadWeek(today.plan, dateKey);
    const deload = readinessDeload || scheduledDeload;
    const cycleWeek = planCycleWeek(
      today.plan.started_on,
      today.plan.mesocycle_weeks,
      dateKey,
    );

    planned = buildPlannedSession(
      today.day,
      buildNextSessions(sets, { units, deload }),
      units,
      { deload },
    );

    if (deload) {
      const reason =
        scheduledDeload && readinessDeload
          ? `Week ${cycleWeek} is your planned deload, and your readiness signals agree.`
          : scheduledDeload
            ? `Week ${cycleWeek} is your planned deload.`
            : "Your recent training signals call for recovery.";
      deloadMessage = `${reason} Today has about half the sets. Loaded exercises with history are about 15% lighter, and effort is capped at RPE 6.`;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-semibold">
          {today ? today.day.name : "Log a workout"}
        </h1>
        {/* Scan lives inside Log, and reads as a real action rather than a hint. */}
        <Link
          href="/scan?draft=1"
          className="btn flex-shrink-0 border border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
        >
          <ScanLine className="h-4 w-4" />
          Scan
        </Link>
      </div>

      {today && (
        <div className="flex items-start gap-2.5 rounded-xl border border-brand/25 bg-brand/10 px-3 py-2.5">
          <CalendarCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" />
          <p className="min-w-0 text-xs leading-snug text-brand">
            Today from {today.plan.name}
            {today.day.focus && `. ${today.day.focus}`}. It is already filled in, so change what
            differs and save.
          </p>
        </div>
      )}

      {deloadMessage && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
          <TrendingDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
          <p className="min-w-0 text-xs leading-snug text-warning">
            <span className="font-semibold">Deload active.</span> {deloadMessage}
          </p>
        </div>
      )}

      <LogForm exercises={exercises} units={units} planned={planned} />

      <CheckinSection today={todayCheckin} />
    </div>
  );
}
