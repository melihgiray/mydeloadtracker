import type { ComponentType } from "react";

/** Any lucide icon or custom glyph that accepts a className. */
type IconLike = ComponentType<{ className?: string }>;

// Vibrant gradient icon tiles, the "fresh" iconography this app's category and
// stat surfaces use (in the spirit of MyFitnessPal / Strava). The readiness
// instrument keeps its semantic colors; these are for navigation and identity,
// where color is allowed to be friendly.
const PALETTE: Record<string, [string, string]> = {
  blue: ["222 86% 60%", "228 84% 54%"],
  indigo: ["248 80% 66%", "256 82% 60%"],
  violet: ["270 80% 67%", "278 80% 60%"],
  teal: ["172 70% 45%", "166 72% 40%"],
  cyan: ["190 85% 52%", "198 86% 47%"],
  green: ["150 68% 47%", "146 70% 41%"],
  lime: ["96 62% 50%", "110 60% 44%"],
  amber: ["40 95% 56%", "34 95% 51%"],
  orange: ["26 92% 57%", "18 90% 52%"],
  rose: ["340 82% 64%", "348 84% 58%"],
  red: ["6 82% 62%", "2 80% 56%"],
};

export type BadgeColor = keyof typeof PALETTE;

const TILE: Record<string, string> = {
  sm: "h-9 w-9 rounded-xl",
  md: "h-11 w-11 rounded-[0.9rem]",
  lg: "h-14 w-14 rounded-2xl",
};
const GLYPH: Record<string, string> = {
  sm: "h-[18px] w-[18px]",
  md: "h-5 w-5",
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
  const [a, b] = PALETTE[color] ?? PALETTE.blue;
  return (
    <span
      className={`grid flex-shrink-0 place-items-center text-white ${TILE[size]}`}
      style={{
        backgroundImage: `linear-gradient(140deg, hsl(${a}), hsl(${b}))`,
        boxShadow: `0 8px 18px -8px hsl(${a} / 0.55), inset 0 1px 0 0 hsl(0 0% 100% / 0.18)`,
      }}
    >
      <Icon className={GLYPH[size]} />
    </span>
  );
}
