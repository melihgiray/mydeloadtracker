"use client";

import { usePathname } from "next/navigation";

// Keying the wrapper by pathname remounts it on every navigation, which replays
// the page-in animation, so each screen fades and rises in instead of hard
// cutting. Reduced-motion strips the animation via the global CSS rule.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page">
      {children}
    </div>
  );
}
