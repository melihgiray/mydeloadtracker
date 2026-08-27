"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";

const PRESETS = [90, 120, 180];

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export function RestTimer({ startSignal }: { startSignal?: number } = {}) {
  const [duration, setDuration] = useState(120);
  const [remaining, setRemaining] = useState(120);
  const [running, setRunning] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-start when the caller signals a set was just completed, so finishing a
  // set starts the rest clock without a second tap. Guarded to the first render
  // by requiring a positive, changing signal; it never fires on mount.
  const seenSignal = useRef(startSignal);
  useEffect(() => {
    if (startSignal === undefined || startSignal === seenSignal.current) return;
    seenSignal.current = startSignal;
    setRemaining(duration);
    setRunning(true);
    // duration is read intentionally as the current rest length, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  useEffect(() => {
    if (!running) return;
    ref.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (ref.current) clearInterval(ref.current);
          setRunning(false);
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate?.([200, 100, 200]);
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [running]);

  function setPreset(s: number) {
    setDuration(s);
    setRemaining(s);
    setRunning(false);
  }
  function toggle() {
    if (remaining === 0) setRemaining(duration);
    setRunning((r) => !r);
  }
  function reset() {
    setRunning(false);
    setRemaining(duration);
  }

  const done = remaining === 0;
  const active = running || done;

  // Idle: a slim bar, not a full card. Resting matters after a set, not before,
  // so before you have logged anything the timer stays out of the way and the
  // exercises get the top of the screen. Presets stay visible so you can set the
  // rest length ahead of time.
  if (!active) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <Timer className="h-4 w-4 flex-shrink-0 text-brand" />
        <span className="text-sm font-medium">Rest</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`rounded-lg px-2 py-1 text-xs tabular-nums transition-colors ${
                  duration === p
                    ? "bg-brand text-brand-foreground"
                    : "border border-border text-muted hover:text-foreground"
                }`}
              >
                {fmt(p)}
              </button>
            ))}
          </div>
          <button
            onClick={toggle}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            aria-label="Start timer"
          >
            <Play className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Active: prominent, with a bar that drains as the clock runs, so a glance
  // reads the rest at arm's length. Flips to a brand "rest up" state at zero.
  const pct = duration > 0 ? Math.max(0, Math.min(100, (remaining / duration) * 100)) : 0;
  return (
    <div className={`card ${done ? "border-brand bg-brand/10" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Timer className="h-5 w-5 flex-shrink-0 text-brand" />
          <span className={`text-2xl font-semibold tabular-nums ${done ? "text-brand" : ""}`}>
            {done ? "Rest up" : fmt(remaining)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-surface-hover"
            aria-label={running ? "Pause timer" : "Start timer"}
          >
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={reset}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:bg-surface-hover"
            aria-label="Reset timer"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
