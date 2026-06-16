// The signature element: a readiness pulse. A quiet waveform of the athlete's
// readiness over recent weeks, drawn in the current state accent. It draws once
// on load (gated behind prefers-reduced-motion in globals.css) and is the one
// memorable mark; everything around it stays calm.

interface Pt {
  x: number;
  y: number;
}

function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function ReadinessPulse({
  points,
  color,
  uid = "rp",
  className,
  height = 72,
}: {
  /** Readiness scores 0..100, oldest first. */
  points: number[];
  /** hsl() accent string. */
  color: string;
  /** Unique id so multiple pulses do not share gradient defs. */
  uid?: string;
  className?: string;
  height?: number;
}) {
  const W = 300;
  const H = height;
  const padX = 6;
  const padY = 12;

  const series = points.length >= 2 ? points : [points[0] ?? 50, points[0] ?? 50];
  const n = series.length;
  const pts: Pt[] = series.map((s, i) => ({
    x: padX + (i / (n - 1)) * (W - padX * 2),
    y: H - padY - (Math.max(0, Math.min(100, s)) / 100) * (H - padY * 2),
  }));

  const line = smoothPath(pts);
  const area = `${line} L ${pts[n - 1].x.toFixed(2)} ${H} L ${pts[0].x.toFixed(2)} ${H} Z`;
  const last = pts[n - 1];

  const trend =
    series[n - 1] - series[0] > 4 ? "rising" : series[0] - series[n - 1] > 4 ? "falling" : "steady";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Readiness trend, ${trend}`}
      style={{ color }}
    >
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* baseline */}
      <line
        x1="0"
        y1={H - padY}
        x2={W}
        y2={H - padY}
        stroke="hsl(var(--border))"
        strokeWidth="1"
        strokeDasharray="2 4"
        vectorEffect="non-scaling-stroke"
      />
      <path d={area} fill={`url(#${uid}-fill)`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="animate-pulse-draw"
        style={{ ["--pulse-len" as string]: 1 }}
      />
      {/* live end point */}
      <circle cx={last.x} cy={last.y} r="6" fill={color} opacity="0.18" />
      <circle cx={last.x} cy={last.y} r="3" fill={color} stroke="hsl(var(--surface-2))" strokeWidth="1.5" />
    </svg>
  );
}
