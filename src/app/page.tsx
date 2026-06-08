import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  BarChart3,
  Brain,
  Gauge,
  HeartPulse,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

const FEATURES = [
  {
    icon: TriangleAlert,
    title: "Deload detection",
    body: "A transparent 3-signal model flags exactly when — and why — to back off, before a stall quietly costs you gains.",
  },
  {
    icon: Gauge,
    title: "Readiness score",
    body: "Seven fatigue markers — e1RM regression, RPE creep, workload spikes, sleep and more — combine into one 0–100 daily gauge.",
  },
  {
    icon: Trophy,
    title: "Strength standards",
    body: "Every main lift banded Beginner → Elite by bodyweight-relative strength (à la StrengthLevel) — and it tailors deload timing to your level.",
  },
  {
    icon: BarChart3,
    title: "Smart volume",
    body: "Hard sets per muscle vs the 10–20 growth range — the fair way to balance training, instead of tonnage that just rewards heavy lifts.",
  },
  {
    icon: Brain,
    title: "AI coach",
    body: "Chat with a coach that reasons from your real last-8-weeks numbers and cites specific lifts, weeks, and trends.",
  },
  {
    icon: HeartPulse,
    title: "Recovery check-ins",
    body: "Sleep, soreness, motivation, and energy feed the readiness model — the data foundation for a learned recovery engine.",
  },
];

export default async function LandingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-foreground">
            <Activity className="h-5 w-5" />
          </span>
          MyDeloadTracker
        </div>
        <Link href="/login" className="btn-ghost">
          Sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <span className="mb-4 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          Train hard. Recover smart. Backed by the science.
        </span>
        <h1 className="max-w-3xl text-balance text-4xl font-bold leading-tight sm:text-6xl">
          Know exactly when to{" "}
          <span className="text-brand">push</span> and when to{" "}
          <span className="text-warning">deload</span>.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-muted">
          Most lifters stall because they overtrain or under-recover blind. MyDeloadTracker turns
          your logged sets into estimated-1RM trends, a daily readiness score, and an AI coach that
          tells you when to back off — before a plateau costs you months.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="btn-brand px-6 py-2.5">
            Try it free — demo in 10s
          </Link>
          <Link href="/login" className="btn-ghost px-6 py-2.5">
            I already have an account
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted">
          No credit card. Sign up and tap “Load demo data” to explore a full 8-week athlete.
        </p>
      </section>

      <section className="grid gap-4 pb-12 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <f.icon className="mb-3 h-6 w-6 text-brand" />
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mb-20 rounded-2xl border border-border bg-surface/60 p-6 text-center sm:p-8">
        <h2 className="text-lg font-semibold">Where we&apos;re headed</h2>
        <p className="mx-auto mt-2 max-w-2xl text-pretty text-sm text-muted">
          The web app is the wedge: a coaching engine that already knows your fatigue, your level,
          and your weak points. Next it connects to your wearables for objective recovery (HRV,
          sleep) — and ultimately moves to <span className="text-foreground">hands-free, real-time
          coaching in the gym</span>, so the right cue reaches you mid-set.
        </p>
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        Educational training analytics, not medical advice.
      </footer>
    </main>
  );
}
