"use client";

// Sign out from Settings. The desktop sidebar carries its own sign-out, but the
// mobile bottom nav does not, so without this a phone user has no way out. This
// is the mobile home for it.

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearPersistedState } from "@/lib/use-persistent-state";

export function SignOutButton() {
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
    <button
      onClick={signOut}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-3 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground sm:w-auto sm:px-6"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </button>
  );
}
