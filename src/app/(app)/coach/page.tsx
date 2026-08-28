import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { CoachChat } from "@/components/coach-chat";

export const dynamic = "force-dynamic";

export default function CoachPage() {
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
      <CoachChat />
    </div>
  );
}
