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

  return (
    <div
      className={`card flex flex-wrap items-center justify-between gap-3 ${
        done ? "border-brand bg-brand/10" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-brand" />
        <span className="text-sm font-medium">Rest</span>
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
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-lg font-semibold tabular-nums ${done ? "text-brand" : ""}`}>
          {done ? "Rest up!" : fmt(remaining)}
        </span>
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
  );
}
