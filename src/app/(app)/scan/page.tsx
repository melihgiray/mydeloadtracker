import { createClient } from "@/lib/supabase/server";
import { getExercises, getProfile } from "@/lib/data";
import { BarScanner } from "@/components/bar-scanner";

export const dynamic = "force-dynamic";

export default async function ScanPage({
  searchParams,
}: {
  searchParams: { draft?: string };
}) {
  const supabase = createClient();
  const [exercises, profile] = await Promise.all([getExercises(supabase), getProfile(supabase)]);
  const units = profile?.units ?? "kg";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Scan the bar</h1>
        {/* Kept to two lines: on a vertical recording this sits above the
            result card, and a long intro pushes the money screen off frame. */}
        <p className="text-sm leading-relaxed text-muted">
          Point the camera at the bar. It reads the plates, identifies the lift, and counts your
          reps.
        </p>
      </div>
      <BarScanner
        key={units}
        exercises={exercises}
        units={units}
        draftMode={searchParams.draft === "1"}
      />
    </div>
  );
}
