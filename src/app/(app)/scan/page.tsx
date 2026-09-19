import { createClient } from "@/lib/supabase/server";
import { getExercises, getProfile } from "@/lib/data";
import { BarScanner } from "@/components/bar-scanner";

export const dynamic = "force-dynamic";

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const { draft } = await searchParams;
  const supabase = createClient();
  const [exercises, profile] = await Promise.all([getExercises(supabase), getProfile(supabase)]);
  const units = profile?.units ?? "kg";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <p className="micro">Camera log</p>
        <h1 className="text-3xl font-semibold">Scan a set</h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Record the lift, check the result, then add it to your workout.
        </p>
      </div>
      <BarScanner
        key={units}
        exercises={exercises}
        units={units}
        draftMode={draft === "1"}
      />
    </div>
  );
}
