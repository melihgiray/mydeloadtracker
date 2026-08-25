"use client";

// Wraps a history session card so it can be swiped left to delete on a phone,
// the same delete the visible button performs. The card content is passed
// through untouched.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SwipeToDelete } from "@/components/swipe-to-delete";

export function SwipeableSessionCard({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    const supabase = createClient();
    // Sets are removed via ON DELETE CASCADE.
    await supabase.from("workout_sessions").delete().eq("id", sessionId);
    router.refresh();
  }

  return (
    <SwipeToDelete onDelete={remove} disabled={deleting}>
      {children}
    </SwipeToDelete>
  );
}
