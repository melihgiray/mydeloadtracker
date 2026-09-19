import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanReading } from "@/lib/scan-mapping";

export type ScanCaptureMode = "photo" | "video" | "unknown";
export type ScanLogStatus = "started" | "succeeded" | "failed" | "corrected";

export interface ScanLogEvent {
  attemptId: string;
  event: string;
  stage: string;
  status: ScanLogStatus;
  captureMode?: ScanCaptureMode | null;
  frameCount?: number | null;
  durationMs?: number | null;
  provider?: string | null;
  model?: string | null;
  reading?: ScanReading | null;
  details?: Record<string, unknown>;
}

export type ClientScanLogEvent = Omit<ScanLogEvent, "provider" | "model" | "reading">;

export type ScanLogWriteResult = "recorded" | "unavailable" | "failed";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST204", "PGRST205"]);

export function isScanAttemptId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function scanErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 120),
      message: error.message.slice(0, 500),
    };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      ...(typeof value.code === "string" ? { code: value.code.slice(0, 80) } : {}),
      ...(typeof value.message === "string" ? { message: value.message.slice(0, 500) } : {}),
    };
  }
  return { message: String(error).slice(0, 500) };
}

export function parseClientScanLogEvent(value: unknown): ClientScanLogEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (!isScanAttemptId(event.attemptId)) return null;
  if (typeof event.event !== "string" || event.event.length < 1 || event.event.length > 64) {
    return null;
  }
  if (typeof event.stage !== "string" || event.stage.length < 1 || event.stage.length > 64) {
    return null;
  }
  if (!(["started", "succeeded", "failed", "corrected"] as const).includes(
    event.status as ScanLogStatus,
  )) {
    return null;
  }
  const captureMode = event.captureMode;
  if (
    captureMode != null &&
    captureMode !== "photo" &&
    captureMode !== "video" &&
    captureMode !== "unknown"
  ) {
    return null;
  }
  const frameCount = event.frameCount;
  if (
    frameCount != null &&
    (!Number.isInteger(frameCount) || (frameCount as number) < 0 || (frameCount as number) > 10)
  ) {
    return null;
  }
  const durationMs = event.durationMs;
  if (
    durationMs != null &&
    (!Number.isInteger(durationMs) || (durationMs as number) < 0 || (durationMs as number) > 300_000)
  ) {
    return null;
  }
  const details = event.details;
  if (details != null && (typeof details !== "object" || Array.isArray(details))) return null;
  if (details != null && JSON.stringify(details).length > 8_192) return null;

  return {
    attemptId: event.attemptId,
    event: event.event,
    stage: event.stage,
    status: event.status as ScanLogStatus,
    captureMode: captureMode as ScanCaptureMode | null | undefined,
    frameCount: frameCount as number | null | undefined,
    durationMs: durationMs as number | null | undefined,
    details: details as Record<string, unknown> | undefined,
  };
}

/**
 * Scanner logging is diagnostic and must never become a new way for scanning
 * itself to fail. A missing rollout migration is reported to the caller, and
 * every other write failure is named in server logs without throwing.
 */
export async function recordScanLogs(
  supabase: SupabaseClient,
  userId: string,
  events: ScanLogEvent[],
): Promise<ScanLogWriteResult> {
  if (events.length === 0) return "recorded";

  const { error } = await supabase.from("scan_logs").insert(
    events.map((event) => ({
      user_id: userId,
      attempt_id: event.attemptId,
      event: event.event.slice(0, 64),
      stage: event.stage.slice(0, 64),
      status: event.status,
      capture_mode: event.captureMode ?? null,
      frame_count: event.frameCount ?? null,
      duration_ms: event.durationMs ?? null,
      provider: event.provider?.slice(0, 32) ?? null,
      model: event.model?.slice(0, 120) ?? null,
      reading: event.reading ?? null,
      details: event.details ?? {},
    })),
  );

  if (!error) return "recorded";
  if (MISSING_TABLE_CODES.has(error.code)) return "unavailable";
  console.error("Scanner log write failed:", scanErrorDetails(error));
  return "failed";
}
