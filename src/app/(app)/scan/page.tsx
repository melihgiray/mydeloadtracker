import { createClient } from "@/lib/supabase/server";
import { getExercises, getProfile } from "@/lib/data";
import { BarScanner } from "@/components/bar-scanner";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const supabase = createClient();
  const [exercises, profile] = await Promise.all([getExercises(supabase), getProfile(supabase)]);
  const units = profile?.units ?? "kg";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Scan the bar</h1>
        <p className="text-sm text-muted">
          Snap a photo to read the weight, or <span className="text-foreground">record a rep</span>.
          The AI reads the load <span className="text-foreground">and</span> uses the motion to
          identify the lift and count your reps, then logs it. This is the phone version of the
          glasses experience.
        </p>
      </div>
      <BarScanner exercises={exercises} units={units} />
    </div>
  );
}
