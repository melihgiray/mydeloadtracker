import { NextResponse } from "next/server";
import {
  parseClientScanLogEvent,
  recordScanLogs,
  type ClientScanLogEvent,
} from "@/lib/scan-log";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { events?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 25) {
    return NextResponse.json({ error: "Invalid scanner events." }, { status: 400 });
  }
  const events = body.events.map(parseClientScanLogEvent);
  if (events.some((event) => event == null)) {
    return NextResponse.json({ error: "Invalid scanner events." }, { status: 400 });
  }

  const result = await recordScanLogs(
    supabase,
    user.id,
    events as ClientScanLogEvent[],
  );
  if (result === "failed") {
    return NextResponse.json({ error: "Scanner events could not be recorded." }, { status: 503 });
  }
  return NextResponse.json({ accepted: true, recorded: result === "recorded" });
}
