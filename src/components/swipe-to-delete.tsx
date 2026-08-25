"use client";

// Swipe a row left to reveal a Delete action, the iOS Mail gesture. Vertical
// drags fall through to the scroll (touch-action: pan-y plus an axis lock on
// the first move), so the list still scrolls normally and only a deliberate
// horizontal swipe opens the row.

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

const REVEAL = 92; // px of the delete drawer

export function SwipeToDelete({
  children,
  onDelete,
  disabled = false,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0); // 0 closed, -REVEAL open
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; base: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, base: offset };
    axisRef.current = null;
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // Decide the axis once, from the first meaningful movement.
    if (axisRef.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axisRef.current === "h") {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (axisRef.current !== "h") return; // let the page scroll
    e.preventDefault();
    setOffset(Math.max(-REVEAL, Math.min(0, s.base + dx)));
  }

  function end() {
    if (axisRef.current === "h") setOffset(offset < -REVEAL / 2 ? -REVEAL : 0);
    startRef.current = null;
    axisRef.current = null;
    setDragging(false);
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Delete drawer behind the row. */}
      <button
        type="button"
        aria-label="Delete"
        onClick={() => {
          setOffset(0);
          onDelete();
        }}
        className="absolute inset-y-0 right-0 flex items-center justify-center gap-1.5 bg-danger px-4 text-sm font-semibold text-danger-foreground"
        style={{ width: REVEAL }}
        tabIndex={offset <= -REVEAL / 2 ? 0 : -1}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        className="relative"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 0.22s cubic-bezier(0.2,0.7,0.2,1)",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
