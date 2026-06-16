import { CoachChat } from "@/components/coach-chat";

export const dynamic = "force-dynamic";

export default function CoachPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <h1 className="text-2xl font-semibold">AI coach</h1>
        <p className="text-sm text-muted">
          Reasons from your real numbers: e1RM trends, deload signals, volume, and PRs.
        </p>
      </div>
      <CoachChat />
    </div>
  );
}
