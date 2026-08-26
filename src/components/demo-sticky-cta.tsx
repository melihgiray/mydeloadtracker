"use client";

// A slim sign-up bar pinned to the bottom of the demo page. The demo is eight
// screens tall, and between the hero call and the closing panel a visitor scrolls
// five screens of proof with no way to convert. This keeps a sign-up path in
// reach at every depth, then steps aside once the closing CTA is on screen so the
// two never stack.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function DemoStickyCta({
  href = "/login",
  label = "Track your own, free",
  /** Id of the closing CTA element; the bar hides once it scrolls into view. */
  hideNearId,
}: {
  href?: string;
  label?: string;
  hideNearId?: string;
}) {
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    // Measured on every scroll rather than via IntersectionObserver, which does
    // not fire in some non-painting webviews. Shown once past the hero (so it
    // never covers the hero's own CTA) and hidden once the closing CTA enters the
    // viewport, so the two calls never stack.
    const endEl = hideNearId ? document.getElementById(hideNearId) : null;
    function compute() {
      const vh = window.innerHeight;
      const pastHero = window.scrollY > 560;
      const nearEnd = endEl ? endEl.getBoundingClientRect().top < vh - 24 : false;
      const next = pastHero && !nearEnd;
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShown(next);
      }
    }
    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [hideNearId]);

  return (
    <div
      aria-hidden={!shown}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="border-t border-border bg-surface/90 backdrop-blur transition-all duration-300 ease-out"
        style={{
          transform: shown ? "translateY(0)" : "translateY(100%)",
          opacity: shown ? 1 : 0,
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="min-w-0 text-sm">
            <span className="font-semibold">Your numbers, your coach.</span>{" "}
            <span className="text-muted max-sm:hidden">Free, no credit card.</span>
          </p>
          <Link
            href={href}
            className={`btn-brand flex-shrink-0 ${shown ? "pointer-events-auto" : ""}`}
          >
            {label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
