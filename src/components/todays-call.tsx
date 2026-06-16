"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Tone } from "@/lib/analytics/readiness";
import { toneAccentVar } from "@/lib/ui";
import { ReadinessPulse } from "@/components/readiness-pulse";

/**
 * The dashboard hero and the half-second read. The semantic state tints the
 * whole panel; the verdict word answers "push or back off" before you read a
 * number; the readiness readout settles on load (one orchestrated moment); the
 * pulse shows the trend.
 */
export function TodaysCall({
  score,
  verdict,
  headline,
  detail,
  tone,
  trend,
  primaryHref,
  primaryLabel,
}: {
  score: number;
  verdict: string;
  headline: string;
  detail: string;
  tone: Tone;
  trend: number[];
  primaryHref: string;
  primaryLabel: string;
}) {
  const display = useCountUp(score);
  const accent = toneAccentVar(tone);

  return (
    <section
      className="panel relative overflow-hidden"
      style={{ ["--accent" as string]: accent }}
      aria-label={`Today's call: ${verdict}. Readiness ${score} out of 100.`}
    >
      {/* environment tint: a soft wash of the state accent across the top */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-48"
        style={{ background: "radial-gradient(60% 100% at 30% 0%, hsl(var(--accent) / 0.16), transparent 70%)" }}
      />
      <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: "hsl(var(--accent) / 0.5)" }} />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="micro">Today&apos;s call</span>
          <h1
            className="mt-2 font-display text-[2.5rem] font-semibold leading-[0.95] sm:text-6xl"
            style={{ color: "hsl(var(--accent))" }}
          >
            {verdict}
          </h1>
          <p className="mt-2.5 text-sm font-semibold" style={{ color: "hsl(var(--accent))" }}>
            {headline}
          </p>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">{detail}</p>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end text-right">
          <span className="micro">Readiness</span>
          <span
            className="readout mt-1 text-5xl font-semibold leading-none sm:text-6xl"
            style={{ color: "hsl(var(--accent))" }}
          >
            {display}
          </span>
          <span className="micro mt-1 text-faint">out of 100</span>
        </div>
      </div>

      <div className="relative mt-5">
        <ReadinessPulse points={trend} color="hsl(var(--accent))" uid="hero-pulse" className="h-16 w-full" />
      </div>

      <div className="relative mt-4">
        <Link href={primaryHref} className="btn-brand w-full sm:w-auto sm:px-6">
          {primaryLabel}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

/** Count an integer up to `target` once on mount; static if reduced motion. */
function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(target);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target <= 0) {
      setValue(target);
      return;
    }

    setValue(0);
    let raf = 0;
    let startTs = 0;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min(1, (ts - startTs) / ms);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
