// AI coach endpoint. Streams a Claude response that has the athlete's last
// 8 weeks of training data baked into the system prompt, so it reasons from
// real numbers (e1RM trends, the deload analysis, volume, PRs).

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { buildCoachContext } from "@/lib/analytics/context";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

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

  const [sets, profile, checkins] = await Promise.all([
    getTrainingSets(supabase, 8),
    getProfile(supabase),
    getCheckins(supabase, 30),
  ]);
  const context = buildCoachContext(sets, profile, checkins);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: [
      { type: "text", text: COACH_INSTRUCTIONS },
      {
        // The training data block is large and stable within a session, so we
        // cache it to cut tokens/latency on follow-up turns.
        type: "text",
        text: `=== ATHLETE TRAINING DATA (last 8 weeks) ===\n${context.summary}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
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
