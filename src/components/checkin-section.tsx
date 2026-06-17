"use client";

import { useEffect, useState } from "react";
import { ChevronRight, HeartPulse, X } from "lucide-react";
import { todayKey } from "@/lib/analytics/dates";
import type { DailyCheckin } from "@/lib/types";
import { CheckinCard } from "@/components/checkin-card";
import { IconBadge } from "@/components/icon-badge";

const PROMPT_KEY = "mdt_checkin_prompt";

/**
 * The daily recovery check-in, living in Log. It pops up once per day (the
 * first time you open Log) as a dismissable sheet, and is always available as
 * an editable box at the bottom of the screen.
 */
export function CheckinSection({ today }: { today: DailyCheckin | null }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  // Offer the prompt once per day, only if it has not been logged or dismissed.
  useEffect(() => {
    if (today) return;
    try {
      if (localStorage.getItem(PROMPT_KEY) !== todayKey()) setPromptOpen(true);
    } catch {
      /* no-op */
    }
  }, [today]);

  function dismissPrompt() {
    setPromptOpen(false);
    try {
      localStorage.setItem(PROMPT_KEY, todayKey());
    } catch {
      /* no-op */
    }
  }

  return (
    <>
      {/* First-open-of-day prompt, optional. */}
      {promptOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center"
          onClick={dismissPrompt}
        >
          <div
            className="w-full max-w-md pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-sm font-semibold">How are you recovering today?</p>
              <button
                onClick={dismissPrompt}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Skip <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <CheckinCard today={today} onSaved={dismissPrompt} />
          </div>
        </div>
      )}

      {/* Always-available editable box at the bottom of Log. */}
      {editing ? (
        <CheckinCard today={today} onSaved={() => setEditing(false)} />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="card group flex w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover"
        >
          <IconBadge icon={HeartPulse} color="rose" size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Today&apos;s check-in</p>
            <p className="truncate text-xs text-muted">
              {today ? "Logged, tap to update" : "Tap to log sleep, soreness, energy, and recovery"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-faint transition-colors group-hover:text-foreground" />
        </button>
      )}
    </>
  );
}
