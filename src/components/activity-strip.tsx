import { Flame } from "lucide-react";
import type { Activity } from "@/lib/ui";
import { IconBadge } from "@/components/icon-badge";
import { CountUp } from "@/components/count-up";

/**
 * A glanceable consistency readout: the current week streak and a small 8-week
 * activity histogram. The streak loop is the strongest behavior mechanism in
 * health apps, kept quiet and instrument-like here rather than loud and gamey.
 */
export function ActivityStrip({ activity }: { activity: Activity }) {
  const { streakWeeks, sessionsThisWeek, weeklyCounts } = activity;
  const cap = Math.max(3, ...weeklyCounts);

  return (
    <div className="card flex items-center justify-between gap-5">
      <div className="flex min-w-0 items-center gap-3.5">
        <IconBadge icon={Flame} color="orange" size="md" />
        <div className="min-w-0">
          <span className="micro">Consistency</span>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="readout text-3xl font-semibold leading-none">
              <CountUp value={streakWeeks} />
              {streakWeeks >= 8 ? "+" : ""}
            </span>
            <span className="text-sm text-muted">week streak</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {sessionsThisWeek} {sessionsThisWeek === 1 ? "session" : "sessions"} in the last 7 days
          </p>
        </div>
      </div>

      <div className="flex h-12 flex-shrink-0 items-end gap-1.5" aria-hidden>
        {weeklyCounts.map((c, i) => {
          const isCurrent = i === weeklyCounts.length - 1;
          const h = c === 0 ? 4 : Math.round(8 + (c / cap) * 40);
          return (
            <span
              key={i}
              title={`${c} ${c === 1 ? "session" : "sessions"}`}
              className="animate-grow-h w-2 rounded-full"
              style={{
                ["--bar-h" as string]: `${h}px`,
                animationDelay: `${i * 45}ms`,
                background: c === 0
                  ? "hsl(var(--border-strong))"
                  : isCurrent
                    ? "hsl(var(--brand))"
                    : "hsl(var(--brand) / 0.45)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
