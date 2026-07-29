import type { ComponentType } from "react";

/** Any lucide icon or custom glyph that accepts a className. */
type IconLike = ComponentType<{ className?: string }>;

// Category and stat icons. These are wayfinding, not state, so they are allowed
// to be colourful: a white-on-grey row of tiles reads dead, and the app should
// have some life to it.
//
// The one rule they must respect is that they cannot impersonate a readiness
// verdict. So the hues here are mid-tone and drawn from a curated set that
// stays clear of the semantic trio's exact tones, and the readiness surfaces
// keep using --success / --warning / --danger directly. Mid-500 weights were
// chosen because they hold up on both the cream and the near-black base.
const INK: Record<string, string> = {
  blue: "text-blue-500",
  indigo: "text-indigo-500",
  violet: "text-violet-500",
  cyan: "text-cyan-500",
  teal: "text-teal-500",
  green: "text-emerald-500",
  lime: "text-emerald-500", // no lime in either theme, by request
  amber: "text-amber-500",
  orange: "text-orange-500",
  rose: "text-rose-500",
  red: "text-red-500",
};

export type BadgeColor = keyof typeof INK;

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

export function IconBadge({
  icon: Icon,
  color,
  size = "md",
}: {
  icon: IconLike;
  color: BadgeColor;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={`grid flex-shrink-0 place-items-center border border-border bg-surface-2 ${TILE[size]} ${
        INK[color] ?? INK.blue
      }`}
    >
      <Icon className={GLYPH[size]} />
    </span>
  );
}
