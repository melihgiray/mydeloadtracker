// Generates 8 weeks of realistic demo training for the signed-in user so the
// dashboard, progress view, and AI coach have something to chew on. The data
// is deliberately shaped so the deload algorithm fires all three signals:
//   - Squat, Bench, and OHP plateau for the last several weeks (signal a)
//   - OHP effort climbs while load stays flat (signal b)
//   - Training frequency drops from 4 to 2 sessions in the last 2 weeks (c)

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startOfWeek } from "@/lib/analytics/dates";
import { buildSampleCheckins } from "@/lib/analytics/sample";

export const runtime = "nodejs";

// week index 0 = oldest (7 weeks ago) ... 7 = current week
type Wk = number[]; // length 8

interface PlannedLift {
  name: string;
  reps: number;
  sets: number;
  weights: Wk;
  rpe: Wk;
}

const MAJORS: PlannedLift[] = [
  {
    name: "Barbell Back Squat",
    reps: 5,
    sets: 3,
    weights: [100, 105, 110, 115, 117.5, 117.5, 117.5, 117.5],
    rpe: [7, 7.5, 8, 8, 8.5, 9, 9, 9.5],
  },
  {
    name: "Barbell Bench Press",
    reps: 5,
    sets: 3,
    weights: [70, 72.5, 75, 77.5, 78, 78, 78, 78],
    rpe: [7, 7.5, 8, 8.5, 9, 9, 9.5, 9.5],
  },
  {
    name: "Conventional Deadlift",
    reps: 3,
    sets: 2,
    weights: [140, 145, 150, 155, 160, 162.5, 165, 167.5],
    rpe: [7, 7.5, 8, 8, 8.5, 8.5, 9, 9],
  },
  {
    name: "Overhead Press",
    reps: 5,
    sets: 3,
    weights: [47.5, 48, 50, 50, 50, 50, 50, 50],
    rpe: [7, 7, 7.5, 8, 8.5, 9, 9, 9.5],
  },
];

const constant = (v: number, step = 0): Wk =>
  Array.from({ length: 8 }, (_, i) => v + i * step);

const ACCESSORIES: PlannedLift[] = [
  { name: "Leg Curl", reps: 10, sets: 3, weights: constant(40, 1), rpe: constant(7, 0.2) },
  { name: "Lat Pulldown", reps: 10, sets: 3, weights: constant(55, 1), rpe: constant(7, 0.2) },
  { name: "Triceps Pushdown", reps: 12, sets: 3, weights: constant(25, 0.5), rpe: constant(7, 0.2) },
  { name: "Barbell Row", reps: 8, sets: 3, weights: constant(60, 1), rpe: constant(7.5, 0.1) },
  { name: "Lateral Raise", reps: 15, sets: 3, weights: constant(12, 0.25), rpe: constant(8, 0.1) },
  { name: "Barbell Curl", reps: 10, sets: 3, weights: constant(25, 0.5), rpe: constant(7.5, 0.1) },
];

// Day-of-week offset from Monday for each of the 4 weekly sessions, and which
// lifts happen that day.
const TEMPLATE: { dayOffset: number; lifts: string[] }[] = [
  { dayOffset: 0, lifts: ["Barbell Back Squat", "Leg Curl"] }, // Mon
  { dayOffset: 1, lifts: ["Barbell Bench Press", "Triceps Pushdown", "Lat Pulldown"] }, // Tue
  { dayOffset: 3, lifts: ["Conventional Deadlift", "Barbell Row"] }, // Thu
  { dayOffset: 4, lifts: ["Overhead Press", "Lateral Raise", "Barbell Curl"] }, // Fri
];

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Resolve exercise ids by name (global library).
  const allNames = [...MAJORS, ...ACCESSORIES].map((l) => l.name);
  const { data: exercises, error: exErr } = await supabase
    .from("exercises")
    .select("id, name")
    .in("name", allNames);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

  const idByName = new Map((exercises ?? []).map((e) => [e.name, e.id]));
  const planByName = new Map([...MAJORS, ...ACCESSORIES].map((l) => [l.name, l]));

  // Best-effort: give the demo athlete a bodyweight + sex so the strength
  // standards card populates immediately. Silently ignored if the migration
  // adding these columns (0005) hasn't been applied yet.
  await supabase
    .from("profiles")
    .update({ bodyweight: 85, sex: "male" })
    .eq("id", user.id);

  // Best-effort: seed daily check-ins (incl. HRV / resting HR) so the readiness
  // model's recovery factors light up. Falls back to the 1-5 metrics if the
  // recovery columns (migration 0007) aren't applied, and is skipped entirely if
  // the table (0003) is missing.
  const sampleCi = buildSampleCheckins();
  const ciFull = sampleCi.map((c) => ({
    user_id: user.id,
    date: c.date,
    sleep_quality: c.sleep_quality,
    soreness: c.soreness,
    motivation: c.motivation,
    energy: c.energy,
    resting_hr: c.resting_hr,
    hrv: c.hrv,
  }));
  const { error: ciErr } = await supabase
    .from("daily_checkins")
    .upsert(ciFull, { onConflict: "user_id,date" });
  if (ciErr) {
    const ciBasic = sampleCi.map((c) => ({
      user_id: user.id,
      date: c.date,
      sleep_quality: c.sleep_quality,
      soreness: c.soreness,
      motivation: c.motivation,
      energy: c.energy,
    }));
    await supabase.from("daily_checkins").upsert(ciBasic, { onConflict: "user_id,date" });
  }

  // Clear any previous demo sessions so re-seeding is idempotent.
  await supabase.from("workout_sessions").delete().eq("user_id", user.id);

  const thisMonday = startOfWeek(new Date());

  for (let week = 0; week < 8; week++) {
    const weeksAgo = 7 - week;
    // Last 2 weeks (week 6, 7): only the first 2 sessions -> frequency drop.
    const sessionsThisWeek = week >= 6 ? TEMPLATE.slice(0, 2) : TEMPLATE;

    for (const day of sessionsThisWeek) {
      const performed = new Date(thisMonday);
      performed.setDate(performed.getDate() - weeksAgo * 7 + day.dayOffset);
      performed.setHours(18, 0, 0, 0);

      const { data: session, error: sErr } = await supabase
        .from("workout_sessions")
        .insert({ user_id: user.id, performed_at: performed.toISOString() })
        .select("id")
        .single();
      if (sErr || !session) {
        return NextResponse.json({ error: sErr?.message ?? "session insert failed" }, { status: 500 });
      }

      const rows: Record<string, unknown>[] = [];
      for (const liftName of day.lifts) {
        const plan = planByName.get(liftName);
        const exerciseId = idByName.get(liftName);
        if (!plan || !exerciseId) continue;
        for (let setNo = 1; setNo <= plan.sets; setNo++) {
          rows.push({
            session_id: session.id,
            exercise_id: exerciseId,
            user_id: user.id,
            set_number: setNo,
            reps: plan.reps,
            weight: plan.weights[week],
            rpe: plan.rpe[week],
          });
        }
      }
      if (rows.length) {
        const { error: setErr } = await supabase.from("workout_sets").insert(rows);
        if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
