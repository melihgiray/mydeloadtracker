// Minimal figure glyphs that resemble the movement, drawn in the same line
// style as the rest of the icons. Mapped from an exercise's movement pattern so
// a squat looks like a squat and a bench press looks like a press, instead of a
// generic dumbbell on everything.

import type { ComponentType } from "react";

type GlyphProps = { className?: string };

function G({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

// Standing figure squatting under a bar.
export const SquatGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <circle cx="12" cy="4" r="1.9" />
    <path d="M5 7.5h14" />
    <path d="M12 6v6" />
    <path d="M12 12l-3 3v5M12 12l3 3v5" />
  </G>
);

// Reclined figure pressing a bar up off a bench.
export const BenchGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <path d="M3.5 16.5h11" />
    <path d="M6 16.5v3M12 16.5v3" />
    <circle cx="4" cy="13.5" r="1.5" />
    <path d="M6 14.5h7.5" />
    <path d="M8.5 14l1.5-5M13 14l1-5" />
    <path d="M7 9h9" />
  </G>
);

// Standing figure pressing a bar overhead.
export const PressGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <path d="M5 4.5h14" />
    <circle cx="12" cy="11" r="1.9" />
    <path d="M12 9.2l-4-4.2M12 9.2l4-4.2" />
    <path d="M12 13v4" />
    <path d="M12 17l-2.5 3.5M12 17l2.5 3.5" />
  </G>
);

// Bent-over figure with a bar near the floor (deadlift / hinge).
export const HingeGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <circle cx="6" cy="6" r="1.7" />
    <path d="M7.2 7l5.8 4.5" />
    <path d="M13 11.5V19" />
    <path d="M9.5 9.2V16.5" />
    <path d="M4.5 16.5h10" />
  </G>
);

// Bent figure pulling a bar in toward the torso (row).
export const RowGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <circle cx="5.5" cy="6" r="1.7" />
    <path d="M6.7 7l6 3.5" />
    <path d="M13 10.5V19" />
    <path d="M9.5 9l4 2.6" />
    <path d="M5 13.5h8.5" />
  </G>
);

// Figure hanging from an overhead bar (pull-up / pulldown).
export const PullupGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <path d="M4 4h16" />
    <path d="M9 4v3.5M15 4v3.5" />
    <circle cx="12" cy="9.6" r="1.9" />
    <path d="M12 11.6v5" />
    <path d="M12 16.6l-2.5 3.4M12 16.6l2.5 3.4" />
  </G>
);

// A bent arm curling a dumbbell (arm isolation, curls, extensions).
export const ArmGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <path d="M6 20v-8" />
    <path d="M6 12l6-4" />
    <path d="M10 6l4 4" />
    <path d="M4 20h4" />
  </G>
);

// A plank / core hold.
export const CoreGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <circle cx="4.5" cy="9" r="1.5" />
    <path d="M5.5 10l12 3.6" />
    <path d="M9 11v6.5M17.5 13.6v3.9" />
    <path d="M4.5 18h15" />
  </G>
);

// A dumbbell, the catch-all.
export const DumbbellGlyph = ({ className }: GlyphProps) => (
  <G className={className}>
    <path d="M3 9.5v5M6 7.5v9M18 7.5v9M21 9.5v5M6 12h12" />
  </G>
);

export type Glyph = ComponentType<GlyphProps>;
