"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, Sparkles } from "lucide-react";
import { capture } from "@/lib/track";

interface Message {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

const SUGGESTIONS = [
  "Should I deload this week? Why?",
  "Where am I plateauing and what should I do?",
  "What are my weak points right now?",
  "Plan my training for next week.",
];

export function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;

    const next: Message[] = [...messages, { role: "user", content }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    capture("coach_message_sent", { turn: next.filter((m) => m.role === "user").length });

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "The coach could not be reached. Check your connection and try again.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Try sending that again.";
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: msg, error: true };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col">
      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-md text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand/12 text-brand ring-1 ring-brand/20">
                <Brain className="h-7 w-7" />
              </span>
              <h2 className="text-lg font-semibold">Your AI strength coach</h2>
              <p className="mx-auto mt-1.5 flex max-w-xs items-center justify-center gap-1.5 text-sm text-muted">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                Loaded with your last 8 weeks of training
              </p>
              <div className="mt-6 grid gap-2 text-left">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-hover"
                  >
                    <span>{s}</span>
                    <ArrowUp className="h-3.5 w-3.5 rotate-45 text-faint transition-colors group-hover:text-brand" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const showCursor = m.role === "assistant" && streaming && isLast;
              if (m.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm leading-relaxed text-brand-foreground">
                      {m.content}
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-brand/12 text-brand">
                    <Brain className="h-4 w-4" />
                  </span>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-md border px-4 py-2.5 text-sm leading-relaxed ${
                      m.error
                        ? "border-danger/40 bg-danger/10 text-foreground"
                        : "border-border bg-surface"
                    }`}
                  >
                    {m.content ? (
                      <>
                        {m.content}
                        {showCursor && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
                      </>
                    ) : (
                      <TypingDots />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-brand/60"
      >
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask your coach anything..."
          className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="btn-accent h-11 w-11 flex-shrink-0 rounded-xl p-0"
          aria-label="Send message"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Coach is thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
