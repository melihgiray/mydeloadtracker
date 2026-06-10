// Pulls the last 30 days of Oura recovery into daily_checkins (refreshing the
// token if needed). Upsert only sets hrv/resting_hr/sleep_quality, so manually
// entered soreness/motivation/energy on the same day are preserved.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ouraConfigured, ouraFetchRecovery, ouraRefresh } from "@/lib/wearables/oura";

export const runtime = "nodejs";

export async function POST() {
  if (!ouraConfigured()) {
    return NextResponse.json({ error: "Oura sync is not configured." }, { status: 503 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: conn, error: connErr } = await supabase
    .from("wearable_connections")
    .select("*")
    .eq("provider", "oura")
    .maybeSingle();
  if (connErr || !conn) {
    return NextResponse.json({ error: "Oura is not connected." }, { status: 400 });
  }

  let accessToken: string = conn.access_token;

  // Refresh if the token is expired (or about to be) and we have a refresh token.
  const expSoon = conn.expires_at && new Date(conn.expires_at).getTime() < Date.now() + 60_000;
  if (expSoon && conn.refresh_token) {
    try {
      const t = await ouraRefresh(conn.refresh_token);
      accessToken = t.access_token;
      await supabase
        .from("wearable_connections")
        .update({
          access_token: t.access_token,
          refresh_token: t.refresh_token ?? conn.refresh_token,
          expires_at: t.expires_in
            ? new Date(Date.now() + t.expires_in * 1000).toISOString()
            : null,
        })
        .eq("id", conn.id);
    } catch {
      /* fall through and try the existing token */
    }
  }

  try {
    const recovery = await ouraFetchRecovery(accessToken, 30);
    if (recovery.length) {
      const { error } = await supabase.from("daily_checkins").upsert(
        recovery.map((r) => ({
          user_id: user.id,
          date: r.date,
          hrv: r.hrv,
          resting_hr: r.resting_hr,
          sleep_quality: r.sleep_quality,
        })),
        { onConflict: "user_id,date" },
      );
      if (error) {
        return NextResponse.json(
          { error: "Saved tokens, but writing recovery failed — is migration 0007 applied?" },
          { status: 500 },
        );
      }
    }
    // Touch the connection so "last synced" reflects now.
    await supabase.from("wearable_connections").update({ scope: conn.scope }).eq("id", conn.id);
    return NextResponse.json({ synced: recovery.length });
  } catch {
    return NextResponse.json({ error: "Oura sync failed. Try reconnecting." }, { status: 502 });
  }
}
