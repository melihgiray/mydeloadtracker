const ROLE_REST_SECONDS: Record<string, number> = {
  primary: 180,
  secondary: 120,
  isolation: 90,
};

export interface PlannedRestTarget {
  restSeconds: number | null;
  role: string | null;
}

export function isValidRestDuration(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 15 && (value as number) <= 600;
}

/** Use the plan's explicit rest, then the same role defaults used to size sessions. */
export function plannedRestDuration(target?: PlannedRestTarget | null): number | null {
  if (!target) return null;
  if (isValidRestDuration(target.restSeconds)) return target.restSeconds;
  return target.role ? (ROLE_REST_SECONDS[target.role] ?? null) : null;
}

/** Invalid or absent plan data never overwrites the athlete's timer choice. */
export function resolveRestDuration(requested: unknown, current: number): number {
  return isValidRestDuration(requested) ? requested : current;
}

/** A wall-clock countdown does not pause when mobile browsers throttle intervals. */
export function remainingRestSeconds(deadlineMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1_000));
}
