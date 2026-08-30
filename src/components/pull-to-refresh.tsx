"use client";

// Pull down at the top of the page to refresh, only inside the installed PWA.
// A browser tab already has its own pull-to-refresh, so this stays off there and
// would just fight it. Standalone (home-screen) has no such gesture, which is
// where this earns its place.
//
// The refresh indicator lives in a spacer above the content and the content is
// never wrapped in a CSS transform. A non-none transform on an ancestor becomes
// the containing block for any position:fixed descendant (modals, sticky bars),
// which silently breaks them, so this component keeps its subtree transform-free.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const TRIGGER = 68; // px pulled (after resistance) that arms a refresh
const MAX = 96;

export function PullToRefresh({
  children,
  onRefresh,
  forceEnabled = false,
}: {
  children: React.ReactNode;
  /** Defaults to a soft route refresh. */
  onRefresh?: () => void | Promise<void>;
  /** Test-only: run outside standalone so the gesture can be verified. */
  forceEnabled?: boolean;
}) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  // Keep the callback and router in refs so the listener effect never re-runs
  // mid-gesture (re-attaching window listeners while a pull is in flight can
  // drop the touchend that fires the refresh).
  const onRefreshRef = useRef(onRefresh);
  const routerRef = useRef(router);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    routerRef.current = router;
  }, [onRefresh, router]);

  useEffect(() => {
    const standalone =
      forceEnabled ||
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    // Touch events, not pointer: a scrolling drag makes the browser cancel the
    // pointer stream, but touchmove keeps firing and can preventDefault to hold
    // the page while pulling.
    function onStart(e: TouchEvent) {
      const eligible = window.scrollY <= 0 && !busyRef.current;
      startY.current = eligible ? e.touches[0].clientY : null;
      pullRef.current = 0;
      setIsPulling(eligible);
    }
    function onMove(e: TouchEvent) {
      if (startY.current === null || busyRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 0) {
        const p = Math.min(MAX, dy * 0.5); // resistance
        pullRef.current = p;
        setPull(p);
        if (p > 3) e.preventDefault(); // hold the page still while pulling
      } else if (dy <= 0) {
        pullRef.current = 0;
        setPull(0);
      }
    }
    function onEnd() {
      setIsPulling(false);
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current >= TRIGGER) {
        busyRef.current = true;
        setRefreshing(true);
        setPull(0);
        const run = onRefreshRef.current ? onRefreshRef.current() : routerRef.current.refresh();
        Promise.resolve(run).finally(() => {
          window.setTimeout(() => {
            busyRef.current = false;
            setRefreshing(false);
            pullRef.current = 0;
          }, 650);
        });
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [forceEnabled]);

  const height = refreshing ? TRIGGER / 2 : pull;
  const armed = pull >= TRIGGER;

  return (
    <>
      <div
        aria-hidden={height === 0}
        className="pointer-events-none flex items-end justify-center overflow-hidden"
        style={{
          height,
          opacity: Math.min(1, height / 32),
          transition: isPulling ? "none" : "height 0.2s ease, opacity 0.2s ease",
        }}
      >
        <RefreshCw
          className={`mb-2 h-5 w-5 text-brand ${refreshing ? "animate-spin" : ""}`}
          style={{
            transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
            opacity: armed || refreshing ? 1 : 0.6,
          }}
        />
      </div>
      {children}
    </>
  );
}
