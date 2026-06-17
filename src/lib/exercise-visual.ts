// Visual identity for an exercise: a color keyed to its muscle group and a
// figure glyph keyed to its movement pattern, so a squat looks like a squat and
// a row looks like a row, all in the same line style.

import type { BadgeColor } from "@/components/icon-badge";
import {
  ArmGlyph,
  BenchGlyph,
  CoreGlyph,
  DumbbellGlyph,
  HingeGlyph,
  PressGlyph,
  PullupGlyph,
  RowGlyph,
  SquatGlyph,
  type Glyph,
} from "@/components/exercise-glyphs";

const MUSCLE_COLOR: Record<string, BadgeColor> = {
  Chest: "rose",
  Back: "blue",
  Quads: "indigo",
  Hamstrings: "violet",
  Glutes: "rose",
  Shoulders: "amber",
  Biceps: "cyan",
  Triceps: "teal",
  Calves: "green",
  Core: "orange",
  Abs: "orange",
  Forearms: "lime",
  Traps: "blue",
  Adductors: "teal",
  Abductors: "teal",
};

export function exerciseColor(muscleGroup: string | null | undefined): BadgeColor {
  return MUSCLE_COLOR[muscleGroup ?? ""] ?? "blue";
}

const PATTERN_GLYPH: Record<string, Glyph> = {
  "squat": SquatGlyph,
  "lunge": SquatGlyph,
  "knee extension": SquatGlyph,
  "ankle extension": SquatGlyph,
  "hinge": HingeGlyph,
  "knee flexion": HingeGlyph,
  "horizontal push": BenchGlyph,
  "vertical push": PressGlyph,
  "abduction": PressGlyph,
  "vertical pull": PullupGlyph,
  "horizontal pull": RowGlyph,
  "elbow flexion": ArmGlyph,
  "elbow extension": ArmGlyph,
  "wrist flexion": ArmGlyph,
  "wrist extension": ArmGlyph,
};

/** Pick the figure glyph that best resembles the movement. */
export function exerciseGlyph(ex: {
  movement_pattern?: string | null;
  muscle_group?: string | null;
}): Glyph {
  const mg = (ex.muscle_group ?? "").toLowerCase();
  if (mg === "core" || mg === "abs") return CoreGlyph;

  const mp = (ex.movement_pattern ?? "").toLowerCase().trim();
  if (PATTERN_GLYPH[mp]) return PATTERN_GLYPH[mp];

  // Keyword fallbacks for any pattern not in the table.
  if (mp.includes("push")) return mp.includes("vertical") ? PressGlyph : BenchGlyph;
  if (mp.includes("pull")) return mp.includes("vertical") ? PullupGlyph : RowGlyph;
  if (mp.includes("squat") || mp.includes("lunge") || mp.includes("knee")) return SquatGlyph;
  if (mp.includes("hinge") || mp.includes("hip")) return HingeGlyph;
  if (mp.includes("elbow") || mp.includes("curl")) return ArmGlyph;
  if (mp.includes("rotation") || mp.includes("anti") || mp.includes("flexion")) return CoreGlyph;
  return DumbbellGlyph;
}
