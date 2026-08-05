import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  TRAINING_STYLES,
  isTrainingStyle,
  styleProfile,
  stylePromptLine,
} from "@/lib/training-style";

describe("training style", () => {
  it("offers the three approaches the founder named, and no ranking between them", () => {
    expect(TRAINING_STYLES.map((s) => s.id)).toEqual(["few_hard", "balanced", "more_volume"]);
    for (const style of TRAINING_STYLES) {
      expect(style.label).not.toMatch(/best|optimal|recommended/i);
      expect(style.detail).not.toMatch(/best|optimal|recommended/i);
    }
  });

  it("raises effort as the set count falls", () => {
    // The trade the athlete is actually choosing between. If a future edit
    // breaks the monotonicity, one of the options has stopped being a choice.
    const bySets = [...TRAINING_STYLES].sort((a, b) => a.sets - b.sets);
    for (let i = 1; i < bySets.length; i += 1) {
      expect(bySets[i].rpe).toBeLessThan(bySets[i - 1].rpe);
    }
  });

  it("falls back to balanced for an unanswered or unknown style", () => {
    expect(styleProfile(null).id).toBe(DEFAULT_STYLE);
    expect(styleProfile(undefined).id).toBe(DEFAULT_STYLE);
    expect(styleProfile("wat" as never).id).toBe(DEFAULT_STYLE);
  });

  it("only accepts the three known ids", () => {
    expect(isTrainingStyle("few_hard")).toBe(true);
    expect(isTrainingStyle("balanced")).toBe(true);
    expect(isTrainingStyle(null)).toBe(false);
    expect(isTrainingStyle("2")).toBe(false);
    expect(isTrainingStyle(3)).toBe(false);
  });

  it("gives isolation one more set than compounds, at every style", () => {
    for (const style of TRAINING_STYLES) {
      const line = stylePromptLine(style.id);
      expect(line).toContain(`about ${style.sets} sets for compounds and ${style.sets + 1} for isolation`);
      expect(line).toContain(`RPE ${style.rpe}`);
    }
  });

  it("frames the style as the athlete's choice, not the model's recommendation", () => {
    // Golden rule 4 in prompt form: no trial supports a specific set count, so
    // the prompt must not let the model claim one.
    const line = stylePromptLine("few_hard");
    expect(line).toContain("stated preference");
    expect(line).toMatch(/do not override/i);
  });
});
