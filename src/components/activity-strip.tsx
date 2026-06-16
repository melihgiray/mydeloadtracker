import { Flame } from "lucide-react";
import type { Activity } from "@/lib/ui";

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
      <div className="min-w-0">
        <span className="micro">Consistency</span>
        <div className="mt-1.5 flex items-baseline gap-2">
          <Flame className="h-5 w-5 self-center text-brand" />
          <span className="readout text-3xl font-semibold leading-none">
            {streakWeeks}
            {streakWeeks >= 8 ? "+" : ""}
          </span>
          <span className="text-sm text-muted">week streak</span>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {sessionsThisWeek} {sessionsThisWeek === 1 ? "session" : "sessions"} in the last 7 days
        </p>
      </div>

      <div className="flex h-12 flex-shrink-0 items-end gap-1.5" aria-hidden>
        {weeklyCounts.map((c, i) => {
          const isCurrent = i === weeklyCounts.length - 1;
          const h = c === 0 ? 4 : Math.round(8 + (c / cap) * 40);
          return (
            <span
              key={i}
              title={`${c} ${c === 1 ? "session" : "sessions"}`}
              className="w-2 rounded-full transition-all"
              style={{
                height: `${h}px`,
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
