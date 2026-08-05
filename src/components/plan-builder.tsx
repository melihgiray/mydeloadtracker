"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarDays, Loader2, RefreshCw } from "lucide-react";
import {
  EQUIPMENT_TAGS,
  type EquipmentTag,
  type PlanIntake,
  type SplitPreference,
} from "@/lib/plan-generation";
import type { PlanGoal, PlanWithDays } from "@/lib/types";
import { TRAINING_STYLES, type TrainingStyle } from "@/lib/training-style";

const EQUIPMENT_LABELS: Record<EquipmentTag, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbells",
  machine: "Machines",
  bodyweight: "Bodyweight",
  cable: "Cables",
};

const GOALS: { value: PlanGoal; label: string }[] = [
  { value: "hypertrophy", label: "Build muscle" },
  { value: "strength", label: "Get stronger" },
  { value: "both", label: "Both" },
];

const SPLITS: { value: SplitPreference; label: string }[] = [
  { value: "auto", label: "Coach picks" },
  { value: "upper_lower", label: "Upper and lower" },
  { value: "ppl", label: "Push, pull, legs" },
  { value: "full_body", label: "Full body" },
  { value: "arnold", label: "Arnold split" },
  { value: "custom", label: "Custom" },
];

function initialEquipment(plan: PlanWithDays | null): EquipmentTag[] {
  if (!plan?.equipment.length) return [...EQUIPMENT_TAGS];
  const tags = plan.equipment.filter((item): item is EquipmentTag =>
    EQUIPMENT_TAGS.includes(item as EquipmentTag),
  );
  return tags.length ? tags : [...EQUIPMENT_TAGS];
}

function splitAvoid(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function PlanBuilder({
  initialPlan,
  evidenceCaveat,
}: {
  initialPlan: PlanWithDays | null;
  evidenceCaveat: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(initialPlan == null);
  const [daysPerWeek, setDaysPerWeek] = useState(initialPlan?.days_per_week ?? 4);
  const [sessionMinutes, setSessionMinutes] = useState(initialPlan?.session_minutes ?? 60);
  const [equipment, setEquipment] = useState<EquipmentTag[]>(
    initialEquipment(initialPlan),
  );
  const [goal, setGoal] = useState<PlanGoal>(initialPlan?.goal ?? "both");
  // Null means not asked yet, which is different from balanced. The athlete
  // sets their own set count and effort because no trial supports a specific
  // one (docs/PLANNER_EVIDENCE.md, Q4 returned no_source).
  const [trainingStyle, setTrainingStyle] = useState<TrainingStyle | null>(
    (initialPlan as { training_style?: TrainingStyle | null } | null)?.training_style ?? null,
  );
  const [splitPreference, setSplitPreference] = useState<SplitPreference>(
    initialPlan?.split ?? "auto",
  );
  const [avoid, setAvoid] = useState(initialPlan?.avoid.join(", ") ?? "");
  const [note, setNote] = useState(initialPlan?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Kept apart from the estimate warnings above. An unenforced restriction is
  // not an estimate to review later, it is a constraint the athlete gave that
  // the app could not apply, so it is stated plainly instead of collapsed.
  const [unenforced, setUnenforced] = useState<string[]>([]);

  useEffect(() => {
    if (initialPlan) setEditing(false);
  }, [initialPlan]);

  function toggleEquipment(tag: EquipmentTag) {
    setEquipment((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (equipment.length === 0 || saving) return;
    setError(null);
    setWarnings([]);
    setUnenforced([]);
    setSaving(true);

    const intake: PlanIntake = {
      daysPerWeek,
      sessionMinutes,
      equipment,
      goal,
      avoid: splitAvoid(avoid),
      trainingStyle,
      splitPreference,
      note: note.trim() || null,
    };

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intake),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        warnings?: { message?: string; code?: string }[];
      };
      if (!response.ok) {
        throw new Error(body.error ?? "The coach could not build your plan.");
      }
      const all = body.warnings ?? [];
      const text = (list: typeof all) =>
        list
          .map((warning) => warning.message?.trim())
          .filter((message): message is string => Boolean(message));
      setWarnings(text(all.filter((warning) => warning.code !== "avoid_unmatched")));
      setUnenforced(text(all.filter((warning) => warning.code === "avoid_unmatched")));
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The coach could not build your plan.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (initialPlan && !editing) {
    return (
      <div className="space-y-5">
        <section className="panel">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                Active plan
              </p>
              <h2 className="mt-1 text-xl font-semibold">{initialPlan.name}</h2>
              <p className="mt-1 text-sm text-muted">
                {initialPlan.days_per_week} days per week, {initialPlan.session_minutes ?? "open"}{" "}
                minute sessions, {initialPlan.mesocycle_weeks} week cycle.
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
              <RefreshCw className="h-4 w-4" />
              Replace plan
            </button>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {initialPlan.days.map((day) => (
            <section key={day.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
                    Day {day.day_index + 1}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{day.name}</h3>
                  {day.focus && <p className="text-xs text-muted">{day.focus}</p>}
                </div>
                <CalendarDays className="h-5 w-5 text-muted" />
              </div>
              <ul className="mt-4 divide-y divide-border">
                {day.exercises.map((exercise) => (
                  <li
                    key={exercise.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{exercise.name}</p>
                      <p className="text-xs text-muted">{exercise.muscle_group}</p>
                    </div>
                    <p className="flex-shrink-0 text-sm font-semibold tabular-nums">
                      {exercise.sets} x {exercise.rep_low}
                      {exercise.rep_high !== exercise.rep_low && ` to ${exercise.rep_high}`}
                      {exercise.rpe_target != null && (
                        <span className="font-normal text-muted"> at RPE {exercise.rpe_target}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
          {evidenceCaveat}
        </p>

        {/* Shown open and above the estimates: the athlete asked for something
            the app could not apply, and burying that would imply it was. */}
        {unenforced.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {unenforced.length === 1
                ? "One thing you asked to avoid was not applied"
                : `${unenforced.length} things you asked to avoid were not applied`}
            </p>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed text-muted">
              {unenforced.map((message) => (
                <li key={message} className="rounded-lg bg-background/60 px-3 py-2">
                  {message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <details className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
              {warnings.length} coach {warnings.length === 1 ? "check" : "checks"}
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              These estimates do not block your plan. Review them before your first session.
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
              {warnings.map((warning) => (
                <li key={warning} className="rounded-lg bg-background/60 px-3 py-2">
                  {warning}
                </li>
              ))}
            </ul>
          </details>
        )}

        <Link href="/log" className="btn-brand w-full sm:w-auto">
          Open today&apos;s workout
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="panel space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            Availability
          </p>
          <h2 className="mt-1 text-lg font-semibold">Fit the plan to your week</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium">
            Days per week
            <select
              className="input"
              value={daysPerWeek}
              onChange={(event) => setDaysPerWeek(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((days) => (
                <option key={days} value={days}>
                  {days} {days === 1 ? "day" : "days"}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-sm font-medium">
            Time per session
            <select
              className="input"
              value={sessionMinutes}
              onChange={(event) => setSessionMinutes(Number(event.target.value))}
            >
              {[30, 45, 60, 75, 90, 120].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Equipment you can use</h2>
          <p className="text-sm text-muted">Choose everything you can reliably access.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EQUIPMENT_TAGS.map((tag) => {
            const selected = equipment.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleEquipment(tag)}
                className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors ${
                  selected
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-border bg-background text-muted"
                }`}
              >
                {EQUIPMENT_LABELS[tag]}
              </button>
            );
          })}
        </div>
        {equipment.length === 0 && (
          <p className="text-sm text-danger">Choose at least one equipment option.</p>
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">What should this plan optimize?</h2>
          <p className="text-sm text-muted">Your history already supplies your current level.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {GOALS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={goal === option.value}
              onClick={() => setGoal(option.value)}
              className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors ${
                goal === option.value
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-border bg-background text-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">How do you like to train?</h3>
            <p className="text-xs text-muted">
              There is no single right answer here, so this is yours to pick. It sets your sets and
              how hard each one goes.
            </p>
          </div>
          <div className="grid gap-2">
            {TRAINING_STYLES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={trainingStyle === option.id}
                onClick={() => setTrainingStyle(option.id)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  trainingStyle === option.id
                    ? "border-brand bg-brand/15"
                    : "border-border bg-background"
                }`}
              >
                <span
                  className={`block text-sm font-medium ${
                    trainingStyle === option.id ? "text-brand" : "text-foreground"
                  }`}
                >
                  {option.label}
                </span>
                <span className="block text-xs text-muted">{option.detail}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={trainingStyle === null}
              onClick={() => setTrainingStyle(null)}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                trainingStyle === null ? "border-brand bg-brand/15 text-brand" : "border-border text-muted"
              }`}
            >
              Not sure, pick for me
            </button>
          </div>
        </div>

        <label className="block space-y-1.5 text-sm font-medium">
          Split preference
          <select
            className="input"
            value={splitPreference}
            onChange={(event) => setSplitPreference(event.target.value as SplitPreference)}
          >
            {SPLITS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Constraints</h2>
          <p className="text-sm text-muted">Name movements, injuries, or patterns to keep out.</p>
        </div>
        <label className="block space-y-1.5 text-sm font-medium">
          Things to avoid
          <textarea
            className="input min-h-24 py-3"
            value={avoid}
            onChange={(event) => setAvoid(event.target.value)}
            placeholder="For example, barbell back squats, overhead pressing"
            maxLength={900}
          />
          <span className="block text-xs font-normal text-muted">
            Separate items with commas or new lines.
          </span>
        </label>

        <label className="block space-y-1.5 text-sm font-medium">
          Anything else
          <textarea
            className="input min-h-24 py-3"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional context for your coach"
            maxLength={500}
          />
        </label>
      </section>

      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
        {evidenceCaveat}
      </p>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {initialPlan && (
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
            Keep current plan
          </button>
        )}
        <button
          type="submit"
          className="btn-brand"
          disabled={saving || equipment.length === 0}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Building your plan
            </>
          ) : (
            <>
              Build my plan
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
