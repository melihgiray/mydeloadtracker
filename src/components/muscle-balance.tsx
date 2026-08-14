import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";
import type { MuscleAssessment, WeakPointReport } from "@/lib/analytics/weak-points";
import type { VolumeZone } from "@/lib/analytics/volume-landmarks";
import { exerciseColor } from "@/lib/exercise-visual";
import { IconBadge } from "@/components/icon-badge";

// The per-muscle assessment, made visible. The engine already scored every
// muscle for the planner; this is the first place the athlete gets to see it:
// which muscles lead, which lag behind the rest of their own body, and how
// much direct volume each is getting. Strength is judged against the athlete,
// not a population, so "lagging" means behind what THIS body can already do.

const STATUS: Record<MuscleAssessment["status"], { label: string; cls: string } | null> = {
  lagging: { label: "Lagging", cls: "bg-warning/15 text-warning" },
  leading: { label: "Leading", cls: "bg-success/15 text-success" },
  on_track: { label: "On track", cls: "bg-surface-2 text-muted" },
  unscored: null,
};

const ZONE_LABEL: Record<VolumeZone, string> = {
  none: "no direct sets",
  maintenance: "maintenance volume",
  growth: "growth volume",
  optimal: "optimal volume",
  high: "high volume",
  over_mrv: "over the recovery limit",
};

// Static background classes per muscle color. Written as literals so Tailwind's
// scanner generates them; a template like bg-${color}-500 would be purged.
// Mirrors the INK map in icon-badge, including its emerald substitutions.
const DOT: Record<string, string> = {
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  cyan: "bg-cyan-500",
  teal: "bg-teal-500",
  green: "bg-emerald-500",
  lime: "bg-emerald-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  red: "bg-red-500",
};

function MuscleRow({ m }: { m: MuscleAssessment }) {
  const dot = DOT[exerciseColor(m.muscle)] ?? DOT.blue;
  const status = STATUS[m.status];
  // Strength score is 0 (Beginner) to 4 (Elite). The bar shows where the muscle
  // sits so balance reads at a glance, not just as a word.
  const pct = m.strengthScore != null ? Math.max(4, Math.min(100, (m.strengthScore / 4) * 100)) : 0;

  return (
    <div className="py-3">
      <div className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.muscle}</span>
        <span className="flex-shrink-0 text-xs text-muted">
          {m.strengthLabel ?? "not scored"}
        </span>
        {status && (
          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>
            {status.label}
          </span>
        )}
      </div>

      {m.strengthScore != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${dot}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      <p className="mt-1.5 text-xs text-muted">
        {m.setsPerWeek} {m.setsPerWeek === 1 ? "set" : "sets"} per week
        {m.volumeZone ? `, ${ZONE_LABEL[m.volumeZone]}` : ""}
        {m.basedOn ? ` · from ${m.basedOn}` : ""}
      </p>
    </div>
  );
}

export function MuscleBalance({
  report,
  hasBodyMetrics,
}: {
  report: WeakPointReport;
  /** Strength scoring needs bodyweight and sex; without them only volume shows. */
  hasBodyMetrics: boolean;
}) {
  // Only muscles with something to say: a strength score or some direct volume.
  const shown = report.muscles.filter((m) => m.strengthScore != null || m.setsPerWeek > 0);

  const summary = report.insufficientData
    ? "Log a few main lifts, or tell the coach your bests when you build a plan, and the app will compare your muscle groups here."
    : report.lagging.length > 0
      ? `${report.lagging.map((m) => m.muscle).join(", ")} ${
          report.lagging.length === 1 ? "is" : "are"
        } behind the rest of your lifts. Your plan already puts ${
          report.lagging.length === 1 ? "it" : "them"
        } earlier in the session.`
      : "Your trained muscle groups are in balance, no single group is dragging behind the rest.";

  return (
    <div className="card">
      <div className="mb-1 flex items-center gap-2.5">
        <IconBadge icon={Scale} color="amber" size="sm" />
        <h2 className="font-semibold">Muscle balance</h2>
        <span className="micro ml-auto">strength vs your own body</span>
      </div>
      <p className="mb-3 text-xs text-muted">{summary}</p>

      {!report.insufficientData && (
        <>
          <div className="divide-y divide-border/60">
            {shown.map((m) => (
              <MuscleRow key={m.muscle} m={m} />
            ))}
          </div>

          {!hasBodyMetrics && (
            <p className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
              Add your bodyweight and sex to see a strength level for each muscle, not just volume.
            </p>
          )}
        </>
      )}

      {report.insufficientData && (
        <Link href="/plan" className="btn-ghost mt-1 text-sm">
          Build a plan and tell the coach your lifts
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
