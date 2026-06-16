import { createClient } from "@/lib/supabase/server";
import { getExercises, getProfile } from "@/lib/data";
import { LogForm } from "@/components/log-form";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const supabase = createClient();
  const [exercises, profile] = await Promise.all([
    getExercises(supabase),
    getProfile(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Log workout</h1>
        <p className="text-sm text-muted">
          Add exercises and record sets, reps, weight, and RPE (1 to 10).
        </p>
      </div>
      <LogForm exercises={exercises} units={profile?.units ?? "kg"} />
    </div>
  );
}
