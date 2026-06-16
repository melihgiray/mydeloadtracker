"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Loader2, MessageSquarePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type State = "idle" | "sending" | "done" | "error";

export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<State>("idle");

  async function submit() {
    if (!text.trim() || state === "sending") return;
    setState("sending");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("feedback")
        .insert({ user_id: user?.id ?? null, message: text.trim(), path: pathname });
      if (error) throw error;
      setState("done");
      setText("");
      setTimeout(() => {
        setOpen(false);
        setState("idle");
      }, 1600);
    } catch {
      setState("error");
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-36 right-4 z-40 w-[min(20rem,calc(100vw-2rem))] md:bottom-20">
          <div className="card shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Tell us anything</h3>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {state === "done" ? (
              <p className="flex items-center gap-1.5 py-3 text-sm text-success">
                <Check className="h-4 w-4" /> Thank you, this really helps.
              </p>
            ) : (
              <>
                <textarea
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What's confusing, broken, or missing? Be brutal."
                  className="input resize-none"
                />
                {state === "error" && (
                  <p className="mt-1 text-xs text-danger">Couldn&apos;t send. Try again in a moment.</p>
                )}
                <button
                  onClick={submit}
                  disabled={!text.trim() || state === "sending"}
                  className="btn-brand mt-2 w-full"
                >
                  {state === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send feedback
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Send feedback"
        className="fixed bottom-20 right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-brand text-brand-foreground shadow-lg transition-transform hover:scale-105 md:bottom-5"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquarePlus className="h-5 w-5" />}
      </button>
    </>
  );
}
