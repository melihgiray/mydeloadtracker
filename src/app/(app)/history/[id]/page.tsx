import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getExercises, getProfile, getSessionWithSets } from "@/lib/data";
import { LogForm, type InitialEntry } from "@/components/log-form";

export const dynamic = "force-dynamic";

export default async function EditSessionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";
  const [session, exercises] = await Promise.all([
    getSessionWithSets(supabase, units, params.id),
    getExercises(supabase),
  ]);

  if (!session) notFound();

  // Group the session's sets by exercise, preserving order.
  const grouped = new Map<string, InitialEntry>();
  for (const s of session.sets) {
    const e = grouped.get(s.exerciseId) ?? { exerciseId: s.exerciseId, sets: [] };
    e.sets.push({ reps: s.reps, weight: s.weight, rpe: s.rpe });
    grouped.set(s.exerciseId, e);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/history"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to history
        </Link>
        <h1 className="text-2xl font-semibold">Edit workout</h1>
        <p className="text-sm text-muted">Update sets, reps, weight, RPE, or the date.</p>
      </div>

      <LogForm
        key={units}
        exercises={exercises}
        units={units}
        sessionId={session.id}
        initialDate={session.performed_at.slice(0, 10)}
        initialNotes={session.notes ?? ""}
        initialEntries={[...grouped.values()]}
      />
    </div>
  );
}
