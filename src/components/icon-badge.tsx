import type { ComponentType } from "react";

/** Any lucide icon or custom glyph that accepts a className. */
type IconLike = ComponentType<{ className?: string }>;

// Neon Brutalist icon tiles: flat, hard-edged, and deliberately colour-poor.
//
// Colour has to keep its meaning in this app (lime is push, amber is hold,
// coral is back off), so the old vibrant gradient palette collapses here. The
// decorative hues render as neutral chrome, and only the genuinely semantic
// ones stay coloured, which keeps the lime meaning exactly one thing.
type Tone = "accent" | "warn" | "bad" | "chrome";

const TONE: Record<string, Tone> = {
  blue: "chrome",
  indigo: "chrome",
  violet: "chrome",
  cyan: "chrome",
  teal: "chrome",
  green: "accent",
  lime: "accent",
  amber: "warn",
  orange: "warn",
  rose: "bad",
  red: "bad",
};

export type BadgeColor = keyof typeof TONE;

const TILE: Record<string, string> = {
  sm: "h-9 w-9 rounded-lg",
  md: "h-11 w-11 rounded-xl",
  lg: "h-14 w-14 rounded-xl",
};
const GLYPH: Record<string, string> = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-7 w-7",
};
const INK: Record<Tone, string> = {
  // The positive tone is the SUCCESS mint, not the brand blue: brand is
  // identity and actions, and must not read as a readiness verdict.
  accent: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  chrome: "text-foreground",
};

export function IconBadge({
  icon: Icon,
  color,
  size = "md",
}: {
  icon: IconLike;
  color: BadgeColor;
  size?: "sm" | "md" | "lg";
}) {
  const tone = TONE[color] ?? "chrome";
  return (
    <span
      className={`grid flex-shrink-0 place-items-center border border-border bg-surface-2 ${TILE[size]} ${INK[tone]}`}
    >
      <Icon className={GLYPH[size]} />
    </span>
  );
}
