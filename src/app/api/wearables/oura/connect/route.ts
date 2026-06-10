// Kicks off the Oura OAuth flow: stores a CSRF state cookie and redirects to
// Oura's consent screen.
import { NextResponse } from "next/server";
import { ouraAuthorizeUrl, ouraConfigured } from "@/lib/wearables/oura";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!ouraConfigured()) {
    return NextResponse.json(
      { error: "Oura sync is not configured on this server." },
      { status: 503 },
    );
  }
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/wearables/oura/callback`;
  const state = crypto.randomUUID();

  const res = NextResponse.redirect(ouraAuthorizeUrl(redirectUri, state));
  res.cookies.set("oura_oauth_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
