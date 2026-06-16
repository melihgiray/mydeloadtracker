import type { SetVolumeReport, SetVolumeStatus } from "@/lib/analytics/setVolume";

// 0..SCALE sets/week maps across the bar width; the 10-20 band is the target.
const SCALE = 24;

const STATUS: Record<SetVolumeStatus, { color: string; text: string; label: string }> = {
  low: { color: "hsl(215 14% 58%)", text: "text-muted", label: "Low" },
  building: { color: "hsl(38 92% 55%)", text: "text-warning", label: "Building" },
  optimal: { color: "hsl(152 62% 45%)", text: "text-success", label: "Optimal" },
  high: { color: "hsl(0 72% 58%)", text: "text-danger", label: "High" },
};

export function SetVolumePanel({ report }: { report: SetVolumeReport }) {
  if (report.muscles.length === 0) {
    return <p className="text-sm text-muted">Log some sets to see weekly volume per muscle.</p>;
  }

  const optStart = (10 / SCALE) * 100;
  const optEnd = (20 / SCALE) * 100;

  return (
    <div className="space-y-3.5">
      {report.muscles.map((m) => {
        const st = STATUS[m.status];
        const pct = Math.min(100, (m.setsPerWeek / SCALE) * 100);
        return (
          <div key={m.muscleGroup}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{m.muscleGroup}</span>
              <span className="flex items-baseline gap-2">
                <span className="tabular-nums">
                  {m.setsPerWeek}
                  <span className="text-muted"> sets/wk</span>
                  {m.thisWeek > 0 && (
                    <span className="text-xs text-muted"> · {m.thisWeek} this wk</span>
                  )}
                </span>
                <span className={`text-xs font-medium ${st.text}`}>{st.label}</span>
              </span>
            </div>
            <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-border">
              {/* target hypertrophy zone (10-20 sets) */}
              <div
                className="absolute inset-y-0 bg-success/20"
                style={{ left: `${optStart}%`, width: `${optEnd - optStart}%` }}
              />
              {/* current volume */}
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${pct}%`, background: st.color, opacity: 0.85 }}
              />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted">
        Hard sets per muscle each week (avg of last {report.windowWeeks} wks). The shaded band marks
        the 10 to 20 set hypertrophy range. Compound lifts count toward their primary muscle only.
      </p>
    </div>
  );
}
