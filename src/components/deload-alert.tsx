import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { DeloadReport } from "@/lib/analytics/deload";

/**
 * The deload recommendation, framed as a calm instrument readout: the call, the
 * signals that fired, and a clear next step. Not an error, not a nag.
 */
export function DeloadAlert({ report }: { report: DeloadReport }) {
  const tone = report.recommended ? "var(--danger)" : "var(--success)";

  if (report.recommended) {
    return (
      <div className="card relative overflow-hidden" style={{ ["--accent" as string]: tone }}>
        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: "hsl(var(--accent))" }} />
        <div className="flex items-center justify-between">
          <span className="micro" style={{ color: "hsl(var(--accent))" }}>
            Deload recommended
          </span>
          <SignalMeter count={report.triggeredCount} total={3} />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Several fatigue signals are firing together. A lighter week now lets the fatigue clear so
          your real strength shows up.
        </p>
        <ul className="mt-4 space-y-2">
          {report.reasons.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span
                aria-hidden
                className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: "hsl(var(--accent))" }}
              />
              <span className="leading-snug">{r}</span>
            </li>
          ))}
        </ul>
        <Link href="/coach" className="btn-accent mt-4 w-full sm:w-auto sm:px-5">
          Ask the coach how to deload
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ ["--accent" as string]: tone }}>
      <div className="flex items-center justify-between">
        <span className="micro" style={{ color: "hsl(var(--accent))" }}>
          No deload needed
        </span>
        <SignalMeter count={report.triggeredCount} total={3} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl"
          style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}
        >
          <Check className="h-5 w-5" />
        </span>
        <p className="text-sm text-muted">
          {report.triggeredCount} of 3 fatigue signals active. Keep progressing as planned.
        </p>
      </div>
    </div>
  );
}

/** Three small segments, lit up to the triggered count. */
function SignalMeter({ count, total }: { count: number; total: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-4 rounded-full"
            style={{ background: i < count ? "hsl(var(--accent))" : "hsl(var(--border-strong))" }}
          />
        ))}
      </span>
      <span className="readout text-xs text-muted">
        {count}/{total}
      </span>
    </span>
  );
}
