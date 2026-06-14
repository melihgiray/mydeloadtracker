// Bar scanner — the Phase-1 computer-vision feature. Takes a photo of a loaded
// barbell / dumbbell / machine and uses Claude's vision to read the exercise and
// the weight (counting plates and doing the math). This is the "buy, don't build"
// MVP from docs/GLASSES_TECH_PLAN.md: a frontier VLM gets us a working demo today;
// a specialized on-device model comes later.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTrainingSets } from "@/lib/data";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const PROMPT = `You are a computer-vision module in a strength-training app. The user pointed their camera at their setup. Read it and report what's loaded, using the report_lift tool.

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Scanning isn't configured on this server." }, { status: 503 });
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let image: string | undefined;
  try {
    image = (await req.json()).image;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const m = typeof image === "string" ? image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/) : null;
  if (!m) return NextResponse.json({ error: "Send a JPEG/PNG/WebP image as a data URL." }, { status: 400 });
  const mediaType = m[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  const data = m[2];
  if (data.length > 8_000_000) return NextResponse.json({ error: "Image too large." }, { status: 413 });

  // Bias the exercise guess toward what this athlete actually trains — a still
  // photo is often ambiguous (a racked bar could be squat / front squat / press),
  // and their history is a strong prior that disambiguates.
  const recent = await getTrainingSets(supabase, 8).catch(() => []);
  const freq = new Map<string, number>();
  for (const s of recent) freq.set(s.exerciseName, (freq.get(s.exerciseName) ?? 0) + 1);
  const usual = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n]) => n);
  const hint = usual.length
    ? `\n\nThis athlete most often trains: ${usual.join(", ")}. When the exercise is ambiguous from the photo, prefer one of these and set confidence to medium.`
    : "";

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_lift" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: PROMPT + hint },
          ],
        },
      ],
    });
    const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) return NextResponse.json({ error: "Couldn't read the image. Try a clearer shot." }, { status: 502 });
    return NextResponse.json({ reading: toolUse.input });
  } catch (err) {
    console.error("Scan error:", err);
    return NextResponse.json({ error: "Vision request failed. Try again." }, { status: 502 });
  }
}
