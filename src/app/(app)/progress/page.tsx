import Link from "next/link";
import { ArrowRight, History, LineChart, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getExercises, getProfile, getTrainingSets } from "@/lib/data";
import { buildProgressReport } from "@/lib/analytics/progress";
import { buildRecords } from "@/lib/analytics/records";
import { buildSetVolume } from "@/lib/analytics/setVolume";
import { isStandardLift } from "@/lib/analytics/standards";
import { StrengthStandards } from "@/components/strength-standards";
import { VolumeChart } from "@/components/volume-chart";
import { SetVolumePanel } from "@/components/set-volume";
import { LiftLookup, type LiftDetail } from "@/components/lift-lookup";
import { IconBadge } from "@/components/icon-badge";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const supabase = createClient();
  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";
  const [sets, exercises] = await Promise.all([getTrainingSets(supabase, units, 8), getExercises(supabase)]);

  if (sets.length === 0) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="card max-w-md text-center">
          <div className="mx-auto mb-4 w-fit">
            <IconBadge icon={LineChart} color="green" size="lg" />
          </div>
          <h1 className="text-xl font-semibold">Nothing to chart yet</h1>
          <p className="mt-2 text-sm text-muted">
            Log a few sessions and your strength trends will appear here.
          </p>
          <Link href="/log" className="btn-brand mt-5 w-full sm:w-auto sm:px-6">
            Log a workout
          </Link>
        </div>
      </div>
    );
  }

  const trends = buildProgressReport(sets, 8);
  const status4 = new Map(buildProgressReport(sets, 4).map((p) => [p.exerciseId, p]));
  const records = buildRecords(sets);
  const recMap = new Map(records.map((r) => [r.exerciseName, r]));
  const moveMap = new Map(exercises.map((e) => [e.id, e.movement_pattern]));
  const setVolume = buildSetVolume(sets, 4, 8);
  const sessionCount = new Set(sets.map((s) => s.sessionId)).size;

  const standardLifts = records
    .filter((r) => isStandardLift(r.exerciseName))
    .map((r) => ({ name: r.exerciseName, e1rm: r.bestE1RM }));

  const lifts: LiftDetail[] = trends.map((t) => {
    const s4 = status4.get(t.exerciseId);
    const rec = recMap.get(t.exerciseName);
    return {
      exerciseId: t.exerciseId,
      name: t.exerciseName,
      muscleGroup: t.muscleGroup,
      movementPattern: moveMap.get(t.exerciseId) ?? null,
      isMajor: t.isMajor,
      status: s4?.status ?? t.status,
      changePct: s4?.e1rmChangePct ?? t.e1rmChangePct,
      currentE1RM: t.currentE1RM,
      weeks: t.weeks,
      prE1RM: rec?.bestE1RM ?? t.currentE1RM,
      maxWeight: rec?.maxWeight ?? 0,
    };
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Progress</h1>

      {/* History lives here, opens its own page. */}
      <Link
        href="/history"
        className="card group flex items-center gap-3 transition-colors hover:bg-surface-hover"
      >
        <IconBadge icon={History} color="violet" size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Workout history</p>
          <p className="truncate text-xs text-muted">{sessionCount} sessions, review or edit any of them</p>
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-faint transition-colors group-hover:text-foreground" />
      </Link>

      <StrengthStandards
        lifts={standardLifts}
        units={units}
        initialBodyweight={profile?.bodyweight ?? null}
        initialSex={profile?.sex ?? null}
      />

      <LiftLookup lifts={lifts} units={units} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <div className="mb-1 flex items-center gap-2.5">
            <IconBadge icon={LineChart} color="cyan" size="sm" />
            <h2 className="font-semibold">Weekly sets by muscle group</h2>
            <span className="micro ml-auto">last 8 weeks</span>
          </div>
          <p className="mb-4 text-xs text-muted">
            Hard sets, the fair way to compare muscles. The honest measure of training stimulus.
          </p>
          <VolumeChart report={setVolume} unit="sets" />
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-1 flex items-center gap-2.5">
            <IconBadge icon={Target} color="green" size="sm" />
            <h2 className="font-semibold">Vs the growth target</h2>
          </div>
          <p className="mb-4 text-xs text-muted">
            About 10 to 20 hard sets per muscle each week is the range research favors.
          </p>
          <SetVolumePanel report={setVolume} />
        </div>
      </div>
    </div>
  );
}
