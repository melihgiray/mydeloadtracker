import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MobileNav, NavBar } from "@/components/nav-bar";
import { PageTransition } from "@/components/page-transition";
import { FeedbackWidget } from "@/components/feedback-widget";
import { IdentifyUser } from "@/components/analytics";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <NavBar email={user.email ?? null} />
      {/* min-w-0 stops a wide child (the rest-timer row) from stretching the
          whole column past the viewport, which made the page scroll sideways
          and clipped the Scan button on a phone. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar: the desktop sidebar already carries identity and
            settings. Units used to live here as a quick toggle; they now belong
            to Settings only, so this is just the wordmark and the settings entry. */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface/80 px-5 py-2.5 backdrop-blur md:hidden">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-brand-foreground">
              <Activity className="h-4 w-4" />
            </span>
            MyDeloadTracker
          </Link>
          {/* Settings has no bottom-nav tab, so this gear is its mobile home. */}
          <Link
            href="/settings"
            aria-label="Settings"
            className="tap grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-8">
          <PageTransition>{children}</PageTransition>
        </main>
        <MobileNav />
      </div>
      <FeedbackWidget />
      <IdentifyUser id={user.id} email={user.email} />
    </div>
  );
}
