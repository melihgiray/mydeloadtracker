// Lightweight health/config probe — confirms which integrations a deployment
// actually has wired (env present), without exposing any secret values. Handy
// for verifying a deploy from the outside.
export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    posthog: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    posthogKeyPrefix: (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "").slice(0, 8),
    oura: Boolean(process.env.OURA_CLIENT_ID),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    coachModel: process.env.OLLAMA_COACH_MODEL ?? "qwen3:14b",
    scannerModel: process.env.OLLAMA_SCAN_MODEL ?? "gemma3:12b",
    ollamaGatewayConfigured: Boolean(process.env.OLLAMA_BASE_URL),
  });
}
