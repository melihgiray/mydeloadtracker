// Bar scanner — takes a photo of a loaded barbell / dumbbell / machine and uses
// the local Gemma vision model to read the exercise and weight.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTrainingSets } from "@/lib/data";
import { ollamaChat } from "@/lib/ollama";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = process.env.OLLAMA_SCAN_MODEL ?? "gemma3:12b";

const PROMPT = `You are a computer-vision module in a strength-training app. The user pointed their camera at their setup. Read it and return a structured report of what's loaded.

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

const LIFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    detected: { type: "boolean", description: "true if a barbell, dumbbell, or machine is visible" },
    exercise: { type: "string", description: "best-guess exercise name; empty string if unclear" },
    equipment: { type: "string", enum: ["barbell", "dumbbell", "machine", "bodyweight", "other", "unknown"] },
    total_weight_kg: { type: ["number", "null"], description: "total loaded weight in kg including the bar, or null" },
    per_side_plates_kg: { type: "array", items: { type: "number" }, description: "plate weights on one side in kg" },
    reps: { type: ["integer", "null"], description: "counted repetitions, or null" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    note: { type: "string", description: "one short sentence explaining the read" },
  },
  required: ["detected", "exercise", "equipment", "total_weight_kg", "per_side_plates_kg", "reps", "confidence", "note"],
} as const;

type ScanReading = {
  detected: boolean;
  exercise: string;
  equipment: string;
  total_weight_kg: number | null;
  per_side_plates_kg: number[];
  reps: number | null;
  confidence: "high" | "medium" | "low";
  note: string;
};

const EQUIPMENT = new Set(["barbell", "dumbbell", "machine", "bodyweight", "other", "unknown"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);

function parseReading(content: unknown): ScanReading | null {
  if (typeof content !== "string") return null;
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const confidence = value.confidence;
    const total = value.total_weight_kg;
    const reps = value.reps;
    if (
      typeof value.detected !== "boolean" ||
      typeof value.exercise !== "string" ||
      typeof value.equipment !== "string" ||
      !EQUIPMENT.has(value.equipment) ||
      typeof confidence !== "string" ||
      !CONFIDENCE.has(confidence) ||
      typeof value.note !== "string" ||
      !Array.isArray(value.per_side_plates_kg) ||
      !value.per_side_plates_kg.every((plate) => typeof plate === "number" && Number.isFinite(plate)) ||
      !(total === null || (typeof total === "number" && Number.isFinite(total))) ||
      !(reps === null || (typeof reps === "number" && Number.isInteger(reps)))
    ) return null;

    return {
      detected: value.detected,
      exercise: value.exercise,
      equipment: value.equipment,
      total_weight_kg: total,
      per_side_plates_kg: value.per_side_plates_kg,
      reps,
      confidence: confidence as ScanReading["confidence"],
      note: value.note,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { image?: string; images?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const raw = Array.isArray(body.images) ? body.images : body.image ? [body.image] : [];
  const frames: string[] = [];
  let totalBytes = 0;
  for (const img of raw.slice(0, 10)) {
    const m = typeof img === "string" ? img.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/) : null;
    if (!m) continue;
    totalBytes += m[2].length;
    frames.push(m[2]); // Ollama's REST API accepts base64 image bytes.
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

  try {
    const res = await ollamaChat({
      model: MODEL,
      stream: false,
      format: LIFT_SCHEMA,
      think: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "10m",
      options: { temperature: 0, num_ctx: Number(process.env.OLLAMA_CONTEXT_WINDOW ?? 16384) },
      messages: [
        {
          role: "user",
          content: `${PROMPT}${hint}${frameNote}\n\nReturn only JSON matching this schema:\n${JSON.stringify(LIFT_SCHEMA)}`,
          images: frames,
        },
      ],
    });
    const body = (await res.json()) as { message?: { content?: unknown } };
    const reading = parseReading(body.message?.content);
    if (!reading) return NextResponse.json({ error: "Couldn't read the image. Try a clearer shot." }, { status: 502 });
    return NextResponse.json({ reading });
  } catch (err) {
    console.error("Scan error:", err);
    return NextResponse.json({ error: "Vision request failed. Try again." }, { status: 502 });
  }
}
