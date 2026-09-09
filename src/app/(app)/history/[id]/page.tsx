import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, Brain, Pencil, Target } from "lucide-react";
import { IconBadge } from "@/components/icon-badge";
import { round1 } from "@/lib/analytics/epley";
import {
  getProfile,
  getSessionWithSets,
  getTrainingSetsForExercises,
} from "@/lib/data";
import { exerciseColor, exerciseGlyph } from "@/lib/exercise-visual";
import { createClient } from "@/lib/supabase/server";
import { buildWorkoutSummary } from "@/lib/workout-summary";

export const dynamic = "force-dynamic";

const actionLabel = {
  progress: "Progress",
  hold: "Build reps",
  back_off: "Hold",
  deload: "Deload",
} as const;

export default async function WorkoutSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";
  const session = await getSessionWithSets(supabase, units, id);

  if (!session) notFound();

  const history = await getTrainingSetsForExercises(
    supabase,
    units,
    [...new Set(session.sets.map((set) => set.exerciseId))],
  );
  const summary = buildWorkoutSummary(session, history, units);
  const dateLabel = new Date(session.performed_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Link
            href="/history"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Workout history
          </Link>
          <Link
            href={`/history/${id}/edit`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Pencil className="h-4 w-4" /> Edit
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Workout summary</h1>
        <p className="text-sm text-muted">{dateLabel}</p>
      </div>

      <section className="card grid grid-cols-3 gap-2 text-center" aria-label="Workout totals">
        <div>
          <p className="readout text-xl font-semibold">{summary.exerciseCount}</p>
          <p className="text-xs text-muted">Exercises</p>
        </div>
        <div className="border-x border-border">
          <p className="readout text-xl font-semibold">{summary.setCount}</p>
          <p className="text-xs text-muted">Sets</p>
        </div>
        <div>
          <p className="readout text-xl font-semibold">{summary.averageRpe ?? "Not logged"}</p>
          <p className="text-xs text-muted">Average RPE</p>
        </div>
      </section>

      {summary.prNames.length > 0 && (
        <section className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <IconBadge icon={Award} color="amber" size="md" />
            <div className="min-w-0">
              <p className="font-semibold">
                {summary.prNames.length === 1 ? "Personal record" : "Personal records"}
              </p>
              <p className="mt-0.5 text-sm text-muted">{summary.prNames.join(", ")}</p>
            </div>
          </div>
        </section>
      )}

      <div className="space-y-3">
        {summary.exercises.map((exercise) => {
          const Glyph = exerciseGlyph({
            movement_pattern: exercise.movementPattern,
            muscle_group: exercise.muscleGroup,
          });
          const sets = session.sets.filter((set) => set.exerciseId === exercise.exerciseId);

          return (
            <section key={exercise.exerciseId} className="card">
              <div className="flex items-center gap-3">
                <IconBadge icon={Glyph} color={exerciseColor(exercise.muscleGroup)} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{exercise.name}</h2>
                    {exercise.isPr && (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                        PR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    Top set {exercise.topSet.weight > 0 ? `${round1(exercise.topSet.weight)} ${units}` : "Bodyweight"} × {exercise.topSet.reps}
                    {exercise.topSet.rpe != null && ` at RPE ${round1(exercise.topSet.rpe)}`}
                  </p>
                </div>
              </div>

              <div className="mt-3 divide-y divide-border border-y border-border">
                {sets.map((set, index) => (
                  <div key={set.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-10 text-muted">Set {index + 1}</span>
                    <span className="readout flex-1 font-medium tabular-nums">
                      {set.weight > 0 ? `${round1(set.weight)} ${units}` : "Bodyweight"} × {set.reps}
                    </span>
                    <span className="text-xs text-muted">
                      {set.rpe != null ? `RPE ${round1(set.rpe)}` : "RPE not logged"}
                    </span>
                  </div>
                ))}
              </div>

              {exercise.next && (
                <div className="mt-3 rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand">
                      <Target className="h-3.5 w-3.5" /> Next time
                    </span>
                    <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
                      {actionLabel[exercise.next.action]}
                    </span>
                  </div>
                  <p className="readout mt-1 font-semibold tabular-nums">
                    {exercise.next.target.weight > 0
                      ? `${round1(exercise.next.target.weight)} ${units}`
                      : "Bodyweight"}{" "}
                    × {exercise.next.target.reps} reps × {exercise.next.target.sets}{" "}
                    {exercise.next.target.sets === 1 ? "set" : "sets"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{exercise.next.note}</p>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {session.notes && (
        <section className="card">
          <h2 className="text-sm font-semibold">Workout notes</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">{session.notes}</p>
        </section>
      )}

      <Link href={`/coach?session=${id}`} className="btn-brand w-full">
        <Brain className="h-4 w-4" />
        Review with AI coach
      </Link>
    </div>
  );
}
