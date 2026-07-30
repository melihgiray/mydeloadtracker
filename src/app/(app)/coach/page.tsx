import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { CoachChat } from "@/components/coach-chat";

export const dynamic = "force-dynamic";

export default function CoachPage() {
  return (
    <div className="flex h-full flex-col">
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
