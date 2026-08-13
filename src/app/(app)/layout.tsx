import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data";
import { MobileNav, NavBar } from "@/components/nav-bar";
import { PageTransition } from "@/components/page-transition";
import { UnitToggle } from "@/components/unit-toggle";
import { FeedbackWidget } from "@/components/feedback-widget";
import { IdentifyUser } from "@/components/analytics";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfile(supabase);
  const units = profile?.units ?? "kg";

  return (
    <div className="flex min-h-screen">
      <NavBar email={user.email ?? null} />
      {/* min-w-0 stops a wide child (the rest-timer row) from stretching the
          whole column past the viewport, which made the page scroll sideways
          and clipped the Scan button on a phone. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface/80 px-5 py-2 backdrop-blur sm:px-8">
          <span className="text-xs text-muted">Weight units</span>
          <div className="flex items-center gap-2">
            <UnitToggle key={units} initial={units} />
            {/* Settings has no bottom-nav tab, so this gear is its mobile home. */}
            <Link
              href="/settings"
              aria-label="Settings"
              className="tap grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground md:hidden"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
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
