"use client";

import { useEffect, useState } from "react";

/**
 * Count a number up to `target` once on mount, easing out, so a figure lands
 * like it settled rather than appearing fully formed. Respects reduced motion
 * and skips the animation for zero or negative targets (nothing to count to).
 *
 * `decimals` keeps fractional readouts (a 1.32x strength multiple) smooth.
 */
export function useCountUp(target: number, { ms = 900, decimals = 0 } = {}): number {
  const [value, setValue] = useState(() => (target > 0 ? 0 : target));

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // A hidden tab pauses requestAnimationFrame and throttles timers, so an
    // animation started there would strand the number at 0 until the page is
    // looked at. There is nothing to animate for eyes that are not on it, so
    // show the final value straight away.
    const hidden = typeof document !== "undefined" && document.hidden;
    if (target <= 0) return;
    if (reduce || hidden) {
      const immediate = window.setTimeout(() => setValue(target), 0);
      return () => window.clearTimeout(immediate);
    }

    const round = (n: number) => {
      const p = 10 ** decimals;
      return Math.round(n * p) / p;
    };

    let raf = 0;
    let startTs = 0;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min(1, (ts - startTs) / ms);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    // Safety net. requestAnimationFrame is throttled or never fires in a
    // backgrounded tab, and without this the number would be stranded at the 0
    // we just set, so a new athlete could open to a readiness of 0. The timeout
    // guarantees the real value lands even if the animation never runs.
    const guarantee = setTimeout(() => setValue(target), ms + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(guarantee);
    };
  }, [target, ms, decimals]);

  return value;
}

/**
 * A number that counts up on mount. `format` renders the live value, so callers
 * can add a unit or a suffix (e.g. `n => `${n}x``).
 */
export function CountUp({
  value,
  decimals = 0,
  ms = 900,
  format,
  className,
}: {
  value: number;
  decimals?: number;
  ms?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const n = useCountUp(value, { ms, decimals });
  const text = format ? format(n) : decimals > 0 ? n.toFixed(decimals) : String(n);
  return <span className={className}>{text}</span>;
}
