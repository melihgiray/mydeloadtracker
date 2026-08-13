"use client";

// Error boundary for every authenticated screen. Without one, a page that
// throws during render left the installed PWA on a dead/blank screen with no
// way out. This catches it and offers a retry instead.
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced to the console (and any error tracker) so a recurring crash is
    // diagnosable rather than silent.
    console.error("App screen error:", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="card max-w-sm text-center">
        <h1 className="text-lg font-semibold">This screen hit a snag</h1>
        <p className="mt-2 text-sm text-muted">
          Something failed to load. Your logged training is safe. Try again, and
          if it keeps happening, tell the coach and we will fix it.
        </p>
        <button onClick={reset} className="btn-brand mt-4 w-full">
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
