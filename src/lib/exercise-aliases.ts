// Alternate names lifters actually type, mapped to our canonical exercise
// names, so search finds "skull crusher", "RDL", or "pec deck" even though the
// library row is named differently. Keyed by the database name; entries exist
// for both pre- and post-rename names so search keeps working while a naming
// migration is pending.

const ALIASES: Record<string, string[]> = {
  // Big barbell lifts (strengthlevel's short names)
  "Squat": ["back squat", "barbell squat", "barbell back squat"],
  "Bench Press": ["barbell bench press", "flat bench", "bb bench"],
  "Deadlift": ["conventional deadlift"],
  "Shoulder Press": ["overhead press", "ohp", "strict press", "barbell shoulder press"],
  "Bent Over Row": ["barbell row", "bb row", "bent-over row"],
  "Romanian Deadlift": ["rdl"],
  "Hex Bar Deadlift": ["trap bar deadlift"],
  "Close Grip Bench Press": ["close-grip bench press", "cgbp"],
  "Hip Thrust": ["barbell hip thrust"],

  // Hyphen and plural variants (the normalizer of last resort)
  "Pull Ups": ["pull-up", "pullup", "pull up"],
  "Chin Ups": ["chin-up", "chinup", "chin up"],
  "Push Ups": ["push-up", "pushup", "push up"],
  "Sit Ups": ["sit-up", "situp", "sit up"],
  "Diamond Push Ups": ["diamond push-up"],
  "Neutral Grip Pull Ups": ["neutral-grip pull-up", "hammer grip pull up"],
  "EZ Bar Curl": ["ez-bar curl", "ez curl"],
  "T Bar Row": ["t-bar row"],

  // Machines and cables, where slang rules
  "Machine Chest Fly": ["pec deck", "pec dec", "butterfly machine", "chest fly machine"],
  "Machine Reverse Fly": ["reverse pec deck", "rear delt machine", "reverse fly machine"],
  "Reverse Pec Deck": ["machine reverse fly", "rear delt machine"],
  "Cable Fly": ["cable crossover", "crossover"],
  "Tricep Pushdown": ["triceps pushdown", "cable pushdown"],
  "Rope Pushdown": ["tricep rope pushdown", "rope tricep pushdown", "triceps rope"],
  "Lying Tricep Extension": ["skull crusher", "skullcrusher", "lying triceps extension"],
  "Overhead Triceps Extension": ["overhead tricep extension", "french press"],
  "Straight-Arm Pulldown": ["lat prayer", "straight arm pushdown", "lat pullover"],
  "Seated Cable Row": ["cable row", "low row"],
  "Face Pull": ["cable face pull", "rear delt pull"],
  "Horizontal Leg Press": ["leg press", "seated leg press"],
  "Sled Leg Press": ["45 degree leg press", "incline leg press"],
  "Chest Press": ["machine chest press", "machine press"],
  "Hip Adduction": ["adductor machine", "inner thigh machine", "hip adductor"],
  "Hip Abduction": ["abductor machine", "outer thigh machine", "hip abductor"],
  "Standing Calf Raise": ["machine calf raise", "calf raise"],
  "Machine Calf Raise": ["standing calf raise", "calf raise"],
  "Seated Calf Raise": ["seated calf machine"],
  "Assisted Pull-Up": ["assisted pullup", "pull up machine", "pull-up machine"],

  // Dumbbell work
  "Dumbbell Lateral Raise": ["lateral raise", "side raise", "side lateral raise"],
  "Dumbbell Bench Press": ["db bench press", "db bench"],
  "Incline Dumbbell Bench Press": ["incline dumbbell press", "incline db press"],
  "Dumbbell Row": ["single arm row", "one arm row", "single-arm dumbbell row"],
  "Dumbbell Bulgarian Split Squat": ["bulgarian split squat", "bss", "split squat"],
  "Seated Dumbbell Curl": ["seated curl", "seated bicep curl"],
  "Kettlebell Swing": ["kb swing"],
};

/** Alternate search names for an exercise (empty when none are known). */
export function aliasesFor(name: string): string[] {
  return ALIASES[name] ?? [];
}
