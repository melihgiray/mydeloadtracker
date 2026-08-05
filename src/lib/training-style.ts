// How the athlete likes to train, and what that implies for sets and effort.
//
// Step 4 of docs/PLANNER_V2_DESIGN.md, and the founder's fourth complaint:
// "there is no single approach training, some people prefer the two set to
// failure approach. Some people prefer 3 sets, some 4, we can not tell people
// the best volume or intensity without getting their data."
//
// They are right, and the research agrees for a reason worth stating: Q3 and Q4
// of the evidence pass both returned `no_source`. No trial has tested an
// imbalance threshold for prioritisation, and none has tested a specialisation
// block, so there is no published set count to prescribe. Asking is not a
// concession to preference, it is the honest position.
//
// On RPE: the founder's view is that most people misestimate it and a flat 9 is
// fine. That is right for the two styles that train close to failure. It would
// contradict the athlete's own answer for someone who chose to leave two or
// three reps in reserve, so the ceiling follows the style rather than being
// global.

export type TrainingStyle = "few_hard" | "balanced" | "more_volume";

export interface StyleProfile {
  id: TrainingStyle;
  label: string;
  /** Shown under the label at intake. The athlete's words, not a prescription. */
  detail: string;
  /** Typical working sets per exercise. */
  sets: number;
  /** Effort ceiling for working sets. */
  rpe: number;
  /** How the coach should describe effort, in the athlete's own terms. */
  effortPhrase: string;
}

export const TRAINING_STYLES: StyleProfile[] = [
  {
    id: "few_hard",
    label: "Few hard sets",
    detail: "Around 2 working sets per exercise, taken to or very near failure.",
    sets: 2,
    rpe: 9.5,
    effortPhrase: "take these to failure or within a rep of it",
  },
  {
    id: "balanced",
    label: "Balanced",
    detail: "Around 3 sets, stopping a rep or two short.",
    sets: 3,
    rpe: 9,
    effortPhrase: "stop about one rep short of failure",
  },
  {
    id: "more_volume",
    label: "More volume",
    detail: "Four or more sets, stopping two to three reps short.",
    sets: 4,
    rpe: 8,
    effortPhrase: "leave two to three reps in reserve",
  },
];

/**
 * The default style when the athlete has not answered.
 *
 * Balanced, and deliberately NOT the same as a stored `balanced`. A null column
 * means "not asked yet", which the intake needs to distinguish so it knows
 * whether to put the question in front of them.
 */
export const DEFAULT_STYLE: TrainingStyle = "balanced";

export function styleProfile(style: TrainingStyle | null | undefined): StyleProfile {
  return TRAINING_STYLES.find((s) => s.id === style) ?? TRAINING_STYLES.find((s) => s.id === DEFAULT_STYLE)!;
}

export function isTrainingStyle(value: unknown): value is TrainingStyle {
  return TRAINING_STYLES.some((s) => s.id === value);
}

/**
 * The sentence the planner prompt uses to describe how this athlete trains.
 *
 * Phrased as their stated preference, not as a recommendation, so the model
 * follows it rather than arguing with it. Isolation work carries one more set
 * than a compound at every style, because it is cheaper to recover from and
 * that is where added volume actually lands.
 */
export function stylePromptLine(style: TrainingStyle | null | undefined): string {
  const p = styleProfile(style);
  return (
    `The athlete trains with ${p.sets} working sets per exercise and prefers to ${p.effortPhrase}, ` +
    `so target RPE ${p.rpe} and use about ${p.sets} sets for compounds and ${p.sets + 1} for isolation. ` +
    `This is their stated preference. Do not override it with a different set count, and do not ` +
    `tell them a different number is optimal, because no trial supports one.`
  );
}
