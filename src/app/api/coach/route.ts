// AI coach endpoint. Streams a Claude response that has the athlete's last
// 8 weeks of training data baked into the system prompt, so it reasons from
// real numbers (e1RM trends, the deload analysis, volume, PRs).

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COACH_MODEL } from "@/lib/ai-model";
import {
  LOCAL_MODELS,
  LOCAL_TIMEOUT_MS,
  cloudAvailable,
  localOptions,
  preferredProvider,
  type Provider,
} from "@/lib/ai-provider";
import { ollamaChat, ollamaTextChunks } from "@/lib/ollama";
import { getCheckins, getProfile, getTrainingSets } from "@/lib/data";
import { buildCoachContext } from "@/lib/analytics/context";

export const runtime = "nodejs";
export const maxDuration = 60;

// Bound chat history so one long conversation cannot evict the athlete's
// training context from the model's window.
const MAX_HISTORY_MESSAGES = 12;

const COACH_INSTRUCTIONS = `You are an expert strength & hypertrophy coach embedded in a training app called MyDeloadTracker. You specialize in progressive overload, fatigue management, and deload timing.

How to coach:
- Reason from the athlete's actual numbers provided below. Cite specific lifts, weeks, e1RM values, RPE, and volume when you make a point.
- Be proactive: surface plateaus, regressions, rising fatigue, weak points, and deload timing without being asked.
- If a deload is recommended, explain exactly which signals fired and propose a concrete deload week (e.g. ~50-60% volume, keep intensity moderate) and when to resume.
- Keep advice practical and specific. Prefer concrete weight/rep/set suggestions over generalities.
- Be concise and direct. Use short paragraphs. Avoid medical claims.

Formatting:
- Write like a human. Never use em dashes, en dashes, or any dash as punctuation. Use commas and periods.
- No exclamation points. Calm, short sentences.
- Plain text only, no markdown. The app shows your reply exactly as written, so asterisks for bold and dashes for bullet lists render as literal characters. Write in sentences and short paragraphs instead. Never use LaTeX or math notation such as \\rightarrow or dollar-sign delimiters.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  // No key is fine when a local model is configured. It is only fatal when the
  // cloud is the only brain available, which the fallback path checks below.
  if (!cloudAvailable() && preferredProvider("coach") !== "local") {
    return NextResponse.json(
      { error: "The coach isn't configured on this server." },
      { status: 503 },
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

  const profile = await getProfile(supabase);
  const [sets, checkins] = await Promise.all([
    getTrainingSets(supabase, profile?.units ?? "kg", 8),
    getCheckins(supabase, 30),
  ]);
  const context = buildCoachContext(sets, profile, checkins);

  const systemText = `=== ATHLETE TRAINING DATA (last 8 weeks) ===\n${context.summary}`;
  const encoder = new TextEncoder();

  /**
   * Try the local model first. This resolves only once Ollama has accepted the
   * request and started responding, so a failure here happens BEFORE a single
   * byte reaches the athlete and the cloud can take over cleanly. Falling back
   * mid-stream is not possible: the reply would already be half written.
   */
  async function localStream(): Promise<ReadableStream | null> {
    try {
      const res = await ollamaChat(
        {
          model: LOCAL_MODELS.coach,
          stream: true,
          // A coach answers directly. The UI is not a reasoning-trace viewer.
          think: false,
          ...localOptions(1024),
          messages: [
            { role: "system", content: `${COACH_INSTRUCTIONS}\n\n${systemText}` },
            // Bound history so one long chat cannot evict the athlete context
            // from the local model's window.
            ...messages.slice(-MAX_HISTORY_MESSAGES),
          ],
        },
        LOCAL_TIMEOUT_MS.coach,
      );
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const text of ollamaTextChunks(res)) {
              controller.enqueue(encoder.encode(text));
            }
          } catch (err) {
            // Past the point of no return, so say so rather than silently
            // truncating. The athlete can re-ask and will land on the cloud.
            controller.enqueue(encoder.encode("\n\n[The coach was cut off. Ask again.]"));
            console.error("Local coach stream error:", err);
          } finally {
            controller.close();
          }
        },
      });
    } catch (err) {
      console.warn("Local coach unavailable, falling back to the cloud:", err);
      return null;
    }
  }

  function cloudStream(): ReadableStream {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = anthropic.messages.stream({
      model: COACH_MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: COACH_INSTRUCTIONS },
        {
          // The training data block is large and stable within a session, so we
          // cache it to cut tokens/latency on follow-up turns.
          type: "text",
          text: systemText,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return new ReadableStream({
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
  }

  let readable: ReadableStream | null =
    preferredProvider("coach") === "local" ? await localStream() : null;
  let served: Provider = readable ? "local" : "cloud";
  if (!readable) {
    if (!cloudAvailable()) {
      return NextResponse.json(
        { error: "The coach isn't reachable right now." },
        { status: 503 },
      );
    }
    readable = cloudStream();
    served = "cloud";
  }

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      // Which brain answered. The client reports it so the local/cloud mix is
      // visible without reading server logs.
      "X-AI-Provider": served,
    },
  });
}
