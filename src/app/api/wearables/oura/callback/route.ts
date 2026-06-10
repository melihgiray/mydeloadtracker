// Oura OAuth callback: verifies state, exchanges the code for tokens, stores the
// connection, runs an initial 30-day sync into daily_checkins, then returns to
// Settings.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ouraConfigured, ouraExchangeCode, ouraFetchRecovery } from "@/lib/wearables/oura";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const settings = (status: string) => NextResponse.redirect(`${origin}/settings?wearable=${status}`);

  if (!ouraConfigured()) return settings("error");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = cookies().get("oura_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) return settings("error");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const token = await ouraExchangeCode(code, `${origin}/api/wearables/oura/callback`);
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

    const { error: connErr } = await supabase.from("wearable_connections").upsert(
      {
        user_id: user.id,
        provider: "oura",
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        expires_at: expiresAt,
        scope: token.scope ?? null,
      },
      { onConflict: "user_id,provider" },
    );
    if (connErr) return settings("error");

    // Initial sync — best effort (won't block a successful connection).
    try {
      const recovery = await ouraFetchRecovery(token.access_token, 30);
      if (recovery.length) {
        await supabase.from("daily_checkins").upsert(
          recovery.map((r) => ({
            user_id: user.id,
            date: r.date,
            hrv: r.hrv,
            resting_hr: r.resting_hr,
            sleep_quality: r.sleep_quality,
          })),
          { onConflict: "user_id,date" },
        );
      }
    } catch {
      /* connection still succeeded; user can hit "Sync now" */
    }

    const res = settings("connected");
    res.cookies.delete("oura_oauth_state");
    return res;
  } catch {
    return settings("error");
  }
}
