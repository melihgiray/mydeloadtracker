import Link from "next/link";
import { ArrowRight, Brain, Dumbbell, History, LineChart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { localDateKey } from "@/lib/analytics/dates";
import { detectDeload } from "@/lib/analytics/deload";
import { computeReadiness } from "@/lib/analytics/readiness";
import { buildReadinessTrend } from "@/lib/analytics/trend";
import { buildProgressReport } from "@/lib/analytics/progress";
import { buildNextSessions } from "@/lib/analytics/progression";
import { buildTodaysCall, buildActivity } from "@/lib/ui";
import { TodaysCall } from "@/components/todays-call";
import { ActivityStrip } from "@/components/activity-strip";
import { IconBadge, type BadgeColor } from "@/components/icon-badge";
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

  if (sets.length === 0) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="panel max-w-md text-center">
          <div className="mx-auto mb-4 w-fit">
            <IconBadge icon={Dumbbell} color="blue" size="lg" />
          </div>
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

  const opts = { bodyweight: profile?.bodyweight ?? null, sex: profile?.sex ?? null, units };
  const deload = detectDeload(sets);
  const readiness = computeReadiness(sets, checkins, new Date(), opts);
  const call = buildTodaysCall(readiness, deload);

  const now = new Date();
  const readinessTrend = buildReadinessTrend(sets, checkins, now, opts);

  const activity = buildActivity(new Set(sets.map((s) => localDateKey(new Date(s.date)))), now);
  const nextCount = buildNextSessions(sets, { units, deload: deload.recommended }).length;
  const progressing = buildProgressReport(sets, 4).filter((p) => p.status === "progressing").length;
  const sessionCount = new Set(sets.map((s) => s.sessionId)).size;

  const primary = call.state === "back-off"
    ? { href: "/insights", label: "Plan my deload week" }
    : { href: "/log", label: "Log today's session" };

  const tiles: { href: string; icon: typeof Brain; color: BadgeColor; label: string; sub: string }[] = [
    { href: "/log", icon: Dumbbell, color: "blue", label: "Log a workout", sub: nextCount > 0 ? `${nextCount} lifts queued up` : "Build a session" },
    { href: "/progress", icon: LineChart, color: "green", label: "Progress", sub: `${progressing} lifts progressing` },
    { href: "/history", icon: History, color: "violet", label: "History", sub: `${sessionCount} sessions logged` },
    { href: "/coach", icon: Brain, color: "indigo", label: "AI coach", sub: "Ask about your training" },
  ];

  return (
    <div className="space-y-4">
      <TrackOnMount event="next_session_viewed" />
      {deload.recommended && <TrackOnMount event="deload_alert_shown" />}

      <div>
        <h1 className="text-2xl font-semibold">
          {profile?.full_name ? profile.full_name.split(" ")[0] : "Today"}
        </h1>
        <p className="mt-0.5 text-sm text-muted">Here is your read for today.</p>
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
        breakdownHref="/insights"
      />

      <ActivityStrip activity={activity} />

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="tap card group p-4 transition-colors hover:bg-surface-hover">
            <div className="flex items-center justify-between">
              <IconBadge icon={t.icon} color={t.color} size="md" />
              <ArrowRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
            <p className="mt-2.5 font-semibold leading-tight">{t.label}</p>
            <p className="text-xs text-muted">{t.sub}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
