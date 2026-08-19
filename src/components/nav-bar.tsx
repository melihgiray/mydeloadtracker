"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Brain, Dumbbell, LayoutDashboard, LineChart, LogOut, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearPersistedState } from "@/lib/use-persistent-state";

// Four primary destinations. Scan lives inside Log; History lives inside
// Progress. Fewer tabs means bigger, easier targets on a phone.
const LINKS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/log", label: "Log", icon: Dumbbell },
  { href: "/progress", label: "Progress", icon: LineChart },
  { href: "/coach", label: "Coach", icon: Brain },
];

function isActive(pathname: string, href: string) {
  if (href === "/progress") return pathname.startsWith("/progress") || pathname.startsWith("/history");
  if (href === "/log") return pathname.startsWith("/log") || pathname.startsWith("/scan");
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/insights");
  if (href === "/coach") return pathname.startsWith("/coach") || pathname.startsWith("/plan");
  return pathname.startsWith(href);
}

export function NavBar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Drop persisted in-progress state so a shared device does not carry one
    // account's conversations into the next sign-in.
    clearPersistedState();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-border bg-surface/50 px-4 py-5 max-md:hidden">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-2 font-display text-[15px] font-semibold tracking-tight">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-foreground">
          <Activity className="h-5 w-5" />
        </span>
        MyDeloadTracker
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-brand/15 font-medium text-brand"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              <link.icon className="h-5 w-5" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border pt-4">
        <Link
          href="/settings"
          className={`tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
            pathname === "/settings"
              ? "bg-brand/15 font-medium text-brand"
              : "text-muted hover:bg-surface-hover hover:text-foreground"
          }`}
        >
          <Settings className="h-5 w-5" />
          Settings
        </Link>
        <p className="mt-3 truncate px-3 text-xs text-muted">{email}</p>
        <button
          onClick={signOut}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 z-20 border-t border-border bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="flex px-2">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className="tap flex flex-1 flex-col items-center gap-1 py-2"
            >
              <span
                className={`grid h-9 w-16 place-items-center rounded-2xl transition-[background-color,transform] duration-200 ${
                  active ? "scale-105 bg-brand/15 text-brand" : "text-muted"
                }`}
              >
                <link.icon className="h-6 w-6" />
              </span>
              <span
                className={`text-[11px] leading-none transition-colors ${
                  active ? "font-semibold text-brand" : "text-muted"
                }`}
              >
                {link.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
