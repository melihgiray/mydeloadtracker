// Thin PostHog wrapper. Everything no-ops silently when NEXT_PUBLIC_POSTHOG_KEY
// is unset, so the app runs identically with analytics off (e.g. local dev).

import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let started = false;
const enabled = () => typeof window !== "undefined" && Boolean(KEY);

export function initPostHog(): void {
  if (started || !enabled()) return;
  posthog.init(KEY as string, {
    api_host: HOST,
    capture_pageview: true,
    autocapture: true,
    person_profiles: "identified_only",
  });
  started = true;
}

/** The funnel events we care about for activation + retention. */
export type TrackEvent =
  | "signup_completed"
  | "onboarding_completed"
  | "workout_logged"
  | "deload_alert_shown"
  | "next_session_viewed"
  | "coach_message_sent"
  | "wearable_connected"
  | "demo_viewed"
  | "bar_scanned"
  | "scan_added_to_draft"
  | "scan_failed"
  | "ai_usage";

export function capture(event: TrackEvent, props?: Record<string, unknown>): void {
  if (!enabled()) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* never let analytics break the app */
  }
}

export function identifyUser(id: string, props?: Record<string, unknown>): void {
  if (!enabled()) return;
  try {
    posthog.identify(id, props);
  } catch {
    /* no-op */
  }
}
