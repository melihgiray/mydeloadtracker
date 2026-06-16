"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Brain,
  Dumbbell,
  History,
  LayoutDashboard,
  LineChart,
  LogOut,
  ScanLine,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/log", label: "Log workout", icon: Dumbbell },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/history", label: "History", icon: History },
  { href: "/progress", label: "Progress", icon: LineChart },
  { href: "/coach", label: "AI coach", icon: Brain },
];

export function NavBar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
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
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-brand/15 font-medium text-brand"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border pt-4">
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
            pathname === "/settings"
              ? "bg-brand/15 font-medium text-brand"
              : "text-muted hover:bg-surface-hover hover:text-foreground"
          }`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <p className="mt-3 truncate px-3 text-xs text-muted">{email}</p>
        <button
          onClick={signOut}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 z-10 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${
              active ? "text-brand" : "text-muted"
            }`}
          >
            <link.icon className="h-5 w-5" />
            {link.label.split(" ")[0]}
          </Link>
        );
      })}
    </nav>
  );
}
