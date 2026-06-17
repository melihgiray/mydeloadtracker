import Link from "next/link";
import { ArrowLeft, CalendarDays, Dumbbell, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getSessionsWithSets } from "@/lib/data";
import { round1 } from "@/lib/analytics/epley";
import { exerciseColor, exerciseGlyph } from "@/lib/exercise-visual";
import { IconBadge } from "@/components/icon-badge";
import { DeleteSessionButton } from "@/components/delete-session-button";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const supabase = createClient();
  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";
  const sessions = await getSessionsWithSets(supabase, units, 60);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/progress"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground md:hidden"
          aria-label="Back to progress"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-semibold">Workout history</h1>
        <Link href="/log" className="btn-brand ml-auto max-sm:hidden sm:px-5">
          <Dumbbell className="h-4 w-4" />
          Log workout
        </Link>
      </div>

      {sessions.length === 0 ? (
        <div className="panel text-center">
          <div className="mx-auto mb-4 w-fit">
            <IconBadge icon={CalendarDays} color="violet" size="lg" />
          </div>
          <p className="text-sm text-muted">No sessions yet.</p>
          <Link href="/log" className="btn-brand mt-4 w-full sm:w-auto sm:px-6">
            Log your first workout
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            // Group sets by exercise for a compact, visual summary.
            const byEx = new Map<
              string,
              { name: string; muscle: string; movement: string | null; count: number; top: number }
            >();
            for (const x of s.sets) {
              const e = byEx.get(x.exerciseId) ?? {
                name: x.exerciseName,
                muscle: x.muscleGroup,
                movement: x.movementPattern,
                count: 0,
                top: 0,
              };
              e.count += 1;
              e.top = Math.max(e.top, x.weight);
              byEx.set(x.exerciseId, e);
            }
            const exercises = [...byEx.values()];
            const setCount = s.sets.length;
            const dateLabel = new Date(s.performed_at).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const head = exercises[0];
            const headColor = exerciseColor(head?.muscle);
            const HeadGlyph = exerciseGlyph({ movement_pattern: head?.movement, muscle_group: head?.muscle });

            return (
              <div key={s.id} className="card">
                <div className="flex items-center gap-3">
                  <IconBadge icon={HeadGlyph} color={headColor} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">{dateLabel}</p>
                    <p className="text-xs text-muted">
                      {exercises.length} {exercises.length === 1 ? "exercise" : "exercises"} · {setCount}{" "}
                      {setCount === 1 ? "set" : "sets"}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Link
                      href={`/history/${s.id}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                      aria-label="Edit session"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <DeleteSessionButton sessionId={s.id} />
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                  {exercises.map((e) => (
                    <div key={e.name} className="flex items-center gap-2.5">
                      <IconBadge
                        icon={exerciseGlyph({ movement_pattern: e.movement, muscle_group: e.muscle })}
                        color={exerciseColor(e.muscle)}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
                      <span className="readout flex-shrink-0 text-xs text-muted">
                        {e.count} × {round1(e.top)} {units}
                      </span>
                    </div>
                  ))}
                </div>

                {s.notes && <p className="mt-3 text-xs italic text-muted">{s.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
