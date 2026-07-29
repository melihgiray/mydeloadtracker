// AI coach endpoint. Streams a local Qwen response that has the athlete's last
// 8 weeks of training data baked into the system prompt, so it reasons from
// real numbers (e1RM trends, the deload analysis, volume, PRs).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { buildCoachContext } from "@/lib/analytics/context";
import { ollamaChat, ollamaTextChunks } from "@/lib/ollama";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OLLAMA_COACH_MODEL ?? "qwen3:14b";
const MAX_HISTORY_MESSAGES = 12;

const COACH_INSTRUCTIONS = `You are an expert strength & hypertrophy coach embedded in a training app called MyDeloadTracker. You specialize in progressive overload, fatigue management, and deload timing.

How to coach:
- Reason from the athlete's actual numbers provided below. Cite specific lifts, weeks, e1RM values, RPE, and volume when you make a point.
- Be proactive: surface plateaus, regressions, rising fatigue, weak points, and deload timing without being asked.
- If a deload is recommended, explain exactly which signals fired and propose a concrete deload week (e.g. ~50-60% volume, keep intensity moderate) and when to resume.
- Keep advice practical and specific. Prefer concrete weight/rep/set suggestions over generalities.
- Be concise and direct. Use short paragraphs and the occasional bullet list. Avoid medical claims.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  const profile = await getProfile(supabase);
  const [sets, checkins] = await Promise.all([
    getTrainingSets(supabase, profile?.units ?? "kg", 8),
    getCheckins(supabase, 30),
  ]);
  const context = buildCoachContext(sets, profile, checkins);

  const stream = await ollamaChat({
    model: MODEL,
    stream: true,
    // A coach should answer directly; the UI is not a reasoning-trace viewer.
    think: false,
    keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "10m",
    options: {
      temperature: 0.25,
      num_ctx: Number(process.env.OLLAMA_CONTEXT_WINDOW ?? 16384),
      num_predict: 1024,
    },
    messages: [
      {
        role: "system",
        content: `${COACH_INSTRUCTIONS}\n\n=== ATHLETE TRAINING DATA (last 8 weeks) ===\n${context.summary}`,
      },
      // Bound history so one long chat cannot evict the athlete context from
      // Qwen's window or exhaust the local machine's memory.
      ...messages.slice(-MAX_HISTORY_MESSAGES),
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of ollamaTextChunks(stream)) controller.enqueue(encoder.encode(text));
      } catch (err) {
        controller.enqueue(
          encoder.encode("\n\n[The coach hit an error. Please try again.]"),
        );
        console.error("Coach stream error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
