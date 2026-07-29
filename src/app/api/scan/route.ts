// Bar scanner — the Phase-1 computer-vision feature. Takes a photo of a loaded
// barbell / dumbbell / machine and uses Claude's vision to read the exercise and
// the weight (counting plates and doing the math). This is the "buy, don't build"
// MVP from docs/GLASSES_TECH_PLAN.md: a frontier VLM gets us a working demo today;
// a specialized on-device model comes later.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTrainingSets } from "@/lib/data";
import { SCAN_MODEL, toUsageReport } from "@/lib/ai-model";
import { MAX_SCAN_FRAMES, evenlySample, type ScanReading } from "@/lib/scan-mapping";
import {
  LOCAL_MODELS,
  LOCAL_TIMEOUT_MS,
  cloudAvailable,
  localOptions,
  preferredProvider,
  type Provider,
} from "@/lib/ai-provider";
import { ollamaChat } from "@/lib/ollama";

export const runtime = "nodejs";
export const maxDuration = 30;



const PROMPT = `You are a computer-vision module in a strength-training app. The user pointed their camera at their setup. Read it and report what's loaded, using the report_lift tool.

How to identify the exercise:
- Use environmental context (squat rack, bench, lat-pulldown machine), the lifter's body position and grip, and — if multiple frames are provided — the MOTION between frames.
- Motion cues: a bar travelling vertically past the shoulders/overhead = squat or press; a hip hinge with the bar near the shins/thighs = deadlift / RDL / row; a horizontal press lying down = bench press.

How to read the weight:
- Standard Olympic barbell = 20 kg (men's) or 15 kg (women's). Assume 20 kg unless it's clearly a thinner/shorter bar.
- Olympic plates are color/size coded (kg): 25=red, 20=blue, 15=yellow, 10=green, 5=white/grey, 2.5=red(small), 1.25=chrome. Count the plates on ONE side, then total = (sum of one side) × 2 + bar.
- Dumbbell: read the number printed on it (that's the per-dumbbell weight).
- Machine / cable stack: read the selected pin number or the printed plate weight.
- Identify the exercise from context (squat rack, bench, lat pulldown, the person's position, grip).
- Be honest about confidence. If plates/numbers aren't legible, say so and give your best estimate with low confidence. Never invent precise numbers you can't see.`;

const TOOL: Anthropic.Tool = {
  name: "report_lift",
  description: "Report the exercise and loaded weight read from the photo.",
  input_schema: {
    type: "object",
    properties: {
      detected: { type: "boolean", description: "true if a barbell/dumbbell/machine with weight is visible" },
      exercise: { type: "string", description: "best-guess exercise name, e.g. 'Barbell Back Squat'. Empty string if unclear." },
      equipment: { type: "string", enum: ["barbell", "dumbbell", "machine", "bodyweight", "other", "unknown"] },
      total_weight_kg: { type: ["number", "null"], description: "total loaded weight in kg incl. bar, or null if unreadable" },
      per_side_plates_kg: { type: "array", items: { type: "number" }, description: "plate weights on ONE side in kg (empty if n/a)" },
      reps: { type: ["integer", "null"], description: "reps if a full set is countable in the image, else null" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      note: { type: "string", description: "one short sentence explaining the read, e.g. '20kg + 10kg per side on a 20kg bar = 80kg.'" },
    },
    required: ["detected", "equipment", "confidence", "note"],
  },
};

export async function POST(req: Request) {
  // A missing key is fine when a local model is configured; the fallback path
  // below is the one that actually needs the cloud.
  if (!cloudAvailable() && preferredProvider("scan") !== "local") {
    return NextResponse.json({ error: "Scanning isn't configured on this server." }, { status: 503 });
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  let body: { image?: string; images?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const raw = Array.isArray(body.images) ? body.images : body.image ? [body.image] : [];
  const frames: { media_type: MediaType; data: string }[] = [];
  let totalBytes = 0;
  // Evenly sampled, not truncated: keeping the first ten of a longer buffer
  // would hide the end of the set from a prompt that claims full coverage.
  for (const img of evenlySample(raw, MAX_SCAN_FRAMES)) {
    const m = typeof img === "string" ? img.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/) : null;
    if (!m) continue;
    totalBytes += m[2].length;
    frames.push({ media_type: m[1] as MediaType, data: m[2] });
  }
  if (frames.length === 0) {
    return NextResponse.json({ error: "Send a JPEG/PNG/WebP image." }, { status: 400 });
  }
  if (totalBytes > 12_000_000) {
    return NextResponse.json({ error: "Images too large." }, { status: 413 });
  }

  // Bias the exercise guess toward what this athlete actually trains — a still
  // photo is often ambiguous (a racked bar could be squat / front squat / press),
  // and their history is a strong prior that disambiguates.
  // Units are irrelevant here: only exercise names feed the prior, not weights.
  const recent = await getTrainingSets(supabase, "kg", 8).catch(() => []);
  const freq = new Map<string, number>();
  for (const s of recent) freq.set(s.exerciseName, (freq.get(s.exerciseName) ?? 0) + 1);
  const usual = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n]) => n);
  const hint = usual.length
    ? `\n\nThis athlete most often trains: ${usual.join(", ")}. When the exercise is ambiguous, prefer one of these.`
    : "";
  const frameNote =
    frames.length > 1
      ? `\n\nThese ${frames.length} images are evenly-spaced frames of ONE set, from start to finish (earliest first). Use the motion across them to identify the exercise, and count each full rep (a complete down-up or up-down cycle). Report your best rep count even if some reps fall between frames.`
      : "";

  const text = PROMPT + hint + frameNote;

  /**
   * Ask the local model, constraining output with Ollama's JSON-schema format
   * rather than a forced tool call, which Ollama does not offer. Returns null
   * on any failure so the caller falls back to the cloud.
   *
   * A schema check is the only automatic guard available here. It catches
   * malformed output, and nothing else: a local model that confidently reports
   * 60 kg for a 100 kg bar produces perfectly valid JSON. Accuracy is a gym
   * benchmark, not a code path. See docs/AI_COST.md.
   */
  async function readLocally(): Promise<ScanReading | null> {
    try {
      const res = await ollamaChat(
        {
          model: LOCAL_MODELS.scan,
          stream: false,
          think: false,
          format: TOOL.input_schema,
          ...localOptions(512),
          messages: [{ role: "user", content: text, images: frames.map((f) => f.data) }],
        },
        LOCAL_TIMEOUT_MS.scan,
      );
      const body = (await res.json()) as { message?: { content?: string } };
      const raw = body.message?.content;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ScanReading;
      // The schema marks these required, so their absence means the model
      // ignored the format and the reading cannot be trusted.
      if (typeof parsed?.detected !== "boolean" || typeof parsed?.confidence !== "string") {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn("Local scan unavailable, falling back to the cloud:", err);
      return null;
    }
  }

  if (preferredProvider("scan") === "local") {
    const reading = await readLocally();
    if (reading) {
      return NextResponse.json({
        reading,
        usage: { model: LOCAL_MODELS.scan, provider: "local" satisfies Provider },
      });
    }
  }

  if (!cloudAvailable()) {
    return NextResponse.json({ error: "Scanning isn't reachable right now." }, { status: 503 });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: SCAN_MODEL,
      max_tokens: 512,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_lift" },
      messages: [
        {
          role: "user",
          content: [
            ...frames.map((f) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: f.media_type, data: f.data },
            })),
            { type: "text" as const, text },
          ],
        },
      ],
    });
    const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) return NextResponse.json({ error: "Couldn't read the image. Try a clearer shot." }, { status: 502 });
    // Usage rides along so the client can report real cost to PostHog.
    return NextResponse.json({
      reading: toolUse.input,
      usage: { ...toUsageReport(SCAN_MODEL, res.usage), provider: "cloud" satisfies Provider },
    });
  } catch (err) {
    console.error("Scan error:", err);
    return NextResponse.json({ error: "Vision request failed. Try again." }, { status: 502 });
  }
}
