import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { CoachChat, type SelectedWorkoutContext } from "@/components/coach-chat";
import { getProfile, getSessionWithSets } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const { session: sessionParam } = await searchParams;
  const sessionId = typeof sessionParam === "string" ? sessionParam : null;
  let selectedWorkout: SelectedWorkoutContext | null = null;

  if (sessionId) {
    const supabase = createClient();
    const profile = await getProfile(supabase);
    const session = await getSessionWithSets(supabase, profile?.units ?? "kg", sessionId);
    if (session) {
      selectedWorkout = {
        id: session.id,
        date: new Date(session.performed_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        exerciseCount: new Set(session.sets.map((set) => set.exerciseId)).size,
        setCount: session.sets.length,
      };
    }
  }

  return (
    // Explicit height so the chat can fill it and pin its input just above the
    // bottom nav. 100dvh (not vh) tracks the mobile toolbar, and the fixed offset
    // plus the safe-area insets account for the header, this page's own heading,
    // the bottom nav, and the notch. h-full did not work: nothing in the wrapper
    // chain (main, PullToRefresh, PageTransition) carries a resolvable height.
    <div className="flex h-[calc(100dvh_-_11.25rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] flex-col">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI coach</h1>
          <p className="text-sm text-muted">
            Reasons from your real numbers: e1RM trends, deload signals, volume, and PRs.
          </p>
        </div>
        <Link href="/plan" className="btn-ghost flex-shrink-0">
          <CalendarDays className="h-4 w-4" />
          Build my plan
        </Link>
      </div>
      <CoachChat selectedWorkout={selectedWorkout} />
    </div>
  );
}
