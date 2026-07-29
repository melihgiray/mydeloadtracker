"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    const supabase = createClient();
    // Sets are removed automatically via ON DELETE CASCADE.
    await supabase.from("workout_sessions").delete().eq("id", sessionId);
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={remove}
          disabled={deleting}
          className="btn inline-flex bg-danger px-3 py-1.5 text-xs text-black hover:opacity-90"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-danger"
    >
      <Trash2 className="h-3.5 w-3.5" /> Delete
    </button>
  );
}
