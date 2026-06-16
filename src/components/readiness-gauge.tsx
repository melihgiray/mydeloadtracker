"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { ReadinessReport, Tone } from "@/lib/analytics/readiness";

const TONE_VAR: Record<Tone, string> = {
  good: "var(--success)",
  caution: "var(--warning)",
  bad: "var(--danger)",
};

// Dash-free band labels (the analytics labels use em dashes we don't render).
const BAND_LABEL: Record<ReadinessReport["band"]["id"], string> = {
  fresh: "Fresh, primed to push",
  solid: "Solid, keep progressing",
  caution: "Caution, monitor fatigue",
  deload: "Deload recommended",
};

// Plain-language description of what each factor measures.
const FACTOR_INFO: Record<string, string> = {
  e1rm_regression:
    "A drop in your best estimated 1RM from its recent peak, the clearest sign fatigue is masking strength.",
  stalled_majors: "Major lifts that have not gained e1RM or volume for 3 or more weeks.",
  rpe_creep: "The same, or lighter, weight feeling harder week over week.",
  wellness: "Your daily sleep, soreness, motivation, and energy check-ins.",
  hrv_depression:
    "Heart-rate variability vs your baseline. A drop means your nervous system has not fully recovered.",
  rhr_elevation:
    "Resting heart rate vs your baseline. A sustained rise is a classic under-recovery sign.",
  frequency_drop: "Training sessions dropping versus your recent average.",
  acwr_spike:
    "This week's volume vs your 6-week average. A fast ramp adds fatigue and injury risk.",
  time_under_load: "Consecutive hard weeks logged without a lighter week.",
};

export function ReadinessGauge({ report }: { report: ReadinessReport }) {
  const [open, setOpen] = useState<string | null>(null);
  const accent = TONE_VAR[report.band.tone];

  // Contributing factors, largest first.
  const factors = report.factors
    .filter((f) => f.value > 0.02)
    .sort((a, b) => b.strength - a.strength);

  return (
    <div className="card" style={{ ["--accent" as string]: accent }}>
      <div className="flex items-center justify-between">
        <span className="micro">Why your score moved</span>
        {factors.length > 0 && <span className="micro text-faint">tap a factor</span>}
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(var(--accent))" }} />
        <p className="text-sm font-semibold" style={{ color: "hsl(var(--accent))" }}>
          {BAND_LABEL[report.band.id]}
        </p>
      </div>
      {report.experienceLabel ? (
        <p className="mt-1 text-xs text-muted">
          {report.experienceLabel} lifter. {report.cadenceNote}.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">
          Add your bodyweight on{" "}
          <Link href="/progress" className="text-brand hover:underline">
            Progress
          </Link>{" "}
          to tune deload timing to your level.
        </p>
      )}

      {factors.length === 0 ? (
        <p className="mt-4 rounded-xl bg-background/60 p-3 text-sm text-muted">
          No meaningful fatigue markers detected. You are recovering well.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {factors.map((f) => {
            const pct = Math.round(f.value * 100);
            const expanded = open === f.id;
            const sev =
              f.value > 0.6 ? "var(--danger)" : f.value > 0.3 ? "var(--warning)" : "var(--success)";
            return (
              <li key={f.id}>
                <button
                  onClick={() => setOpen(expanded ? null : f.id)}
                  className="group w-full rounded-lg text-left"
                  aria-expanded={expanded}
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 text-foreground/90 group-hover:text-foreground">
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                      {f.label}
                    </span>
                    <span className="readout text-xs text-muted">{pct}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${Math.max(4, pct)}%`, background: `hsl(${sev})` }}
                    />
                  </div>
                </button>
                {expanded && (
                  <div className="animate-rise mt-2 rounded-xl bg-background/70 p-3 text-xs leading-relaxed text-muted">
                    <p>{FACTOR_INFO[f.id]}</p>
                    <p className="mt-1.5 text-foreground">{f.detail}</p>
                    <p className="mt-1.5 text-faint">
                      Max influence on score: {Math.round(f.maxStrength * 100)}%
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
