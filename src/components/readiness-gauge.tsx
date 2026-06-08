"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { ReadinessReport, Tone } from "@/lib/analytics/readiness";

const TONE_COLOR: Record<Tone, string> = {
  good: "hsl(var(--success))",
  caution: "hsl(var(--warning))",
  bad: "hsl(var(--danger))",
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-success",
  caution: "text-warning",
  bad: "text-danger",
};

// Plain-language description of what each factor measures.
const FACTOR_INFO: Record<string, string> = {
  e1rm_regression:
    "A drop in your best estimated 1RM from its recent peak — the clearest sign fatigue is masking strength.",
  stalled_majors: "Major lifts that haven't gained e1RM or volume for 3+ weeks.",
  rpe_creep: "The same (or lighter) weight feeling harder week over week.",
  wellness: "Your daily sleep, soreness, motivation, and energy check-ins.",
  hrv_depression:
    "Heart-rate variability vs your baseline — a drop means your nervous system hasn't fully recovered.",
  rhr_elevation:
    "Resting heart rate vs your baseline — a sustained rise is a classic under-recovery sign.",
  frequency_drop: "Training sessions dropping versus your recent average.",
  acwr_spike:
    "This week's volume vs your 6-week average — a fast ramp adds fatigue and injury risk.",
  time_under_load: "Consecutive hard weeks logged without a lighter week.",
};

function Ring({ score, color }: { score: number; color: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return (
    <div className="relative h-32 w-32 flex-shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">{score}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted">readiness</span>
      </div>
    </div>
  );
}

export function ReadinessGauge({ report }: { report: ReadinessReport }) {
  const [open, setOpen] = useState<string | null>(null);
  const color = TONE_COLOR[report.band.tone];

  // Show factors that contribute, largest first; fall back to all if none.
  const active = report.factors
    .filter((f) => f.value > 0.02)
    .sort((a, b) => b.strength - a.strength);
  const factors = active.length ? active : [];

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Training readiness</h2>
        <span className="text-xs text-muted">tap a factor to learn why</span>
      </div>

      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <Ring score={report.score} color={color} />
        <div className="w-full flex-1">
          <p className={`text-lg font-semibold ${TONE_TEXT[report.band.tone]}`}>
            {report.band.label}
          </p>
          {report.experienceLabel ? (
            <p className="mt-0.5 text-xs text-muted">
              {report.experienceLabel} lifter · {report.cadenceNote}.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted">
              Add bodyweight on{" "}
              <Link href="/progress" className="text-brand hover:underline">
                Progress
              </Link>{" "}
              to tune deload timing to your level.
            </p>
          )}

          {factors.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              No meaningful fatigue markers detected — you&apos;re recovering well.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {factors.map((f) => {
                const pct = Math.round(f.value * 100);
                const expanded = open === f.id;
                return (
                  <li key={f.id} className="rounded-lg">
                    <button
                      onClick={() => setOpen(expanded ? null : f.id)}
                      className="group w-full text-left"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 text-muted group-hover:text-foreground">
                          <ChevronDown
                            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                          />
                          {f.label}
                        </span>
                        <span className="tabular-nums text-muted">{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background:
                              f.value > 0.6
                                ? TONE_COLOR.bad
                                : f.value > 0.3
                                  ? TONE_COLOR.caution
                                  : color,
                          }}
                        />
                      </div>
                    </button>
                    {expanded && (
                      <div className="mt-2 rounded-lg bg-background/60 p-2.5 text-xs text-muted">
                        <p>{FACTOR_INFO[f.id]}</p>
                        <p className="mt-1.5 text-foreground">{f.detail}</p>
                        <p className="mt-1.5 opacity-70">
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
      </div>
    </div>
  );
}
