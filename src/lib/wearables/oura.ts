// Oura Ring integration (OAuth2 + v2 API). Pulls objective recovery — HRV,
// resting HR, and a sleep score — and maps it into the daily_checkins shape the
// readiness model already consumes. Enable by setting OURA_CLIENT_ID and
// OURA_CLIENT_SECRET (register a free app at https://cloud.ouraring.com/oauth/applications)
// and adding `<origin>/api/wearables/oura/callback` as a redirect URI there.

const AUTHORIZE = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN = "https://api.ouraring.com/oauth/token";
const API = "https://api.ouraring.com/v2/usercollection";
const SCOPE = "daily heartrate personal";

export function ouraConfigured(): boolean {
  return Boolean(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET);
}

export function ouraAuthorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OURA_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE}?${p.toString()}`;
}

export interface OuraToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<OuraToken> {
  body.set("client_id", process.env.OURA_CLIENT_ID ?? "");
  body.set("client_secret", process.env.OURA_CLIENT_SECRET ?? "");
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Oura token request failed (${res.status})`);
  return (await res.json()) as OuraToken;
}

export function ouraExchangeCode(code: string, redirectUri: string): Promise<OuraToken> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
}

export function ouraRefresh(refreshToken: string): Promise<OuraToken> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

// --- Data mapping -----------------------------------------------------------

export interface RecoveryDay {
  date: string; // YYYY-MM-DD
  hrv: number | null;
  resting_hr: number | null;
  sleep_quality: number | null; // 1-5
}

interface OuraSleep {
  day?: string;
  type?: string;
  average_hrv?: number | null;
  lowest_heart_rate?: number | null;
}
interface OuraDailySleep {
  day?: string;
  score?: number | null;
}

/** Oura sleep score (0-100) -> our 1-5 sleep_quality. */
export function scoreToSleepQuality(score: number | null | undefined): number | null {
  if (score == null) return null;
  if (score >= 85) return 5;
  if (score >= 70) return 4;
  if (score >= 55) return 3;
  if (score >= 40) return 2;
  return 1;
}

function intOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

/** Pure mapper: Oura sleep + daily_sleep documents -> one RecoveryDay per day. */
export function mapOuraToRecovery(sleep: OuraSleep[], dailySleep: OuraDailySleep[]): RecoveryDay[] {
  const byDay = new Map<string, RecoveryDay>();

  for (const s of sleep) {
    if (!s.day) continue;
    const isMain = s.type === "long_sleep";
    const existing = byDay.get(s.day);
    // Prefer the main (long) sleep period for HRV/RHR.
    if (!existing || isMain || (existing.hrv == null && existing.resting_hr == null)) {
      byDay.set(s.day, {
        date: s.day,
        hrv: intOrNull(s.average_hrv),
        resting_hr: intOrNull(s.lowest_heart_rate),
        sleep_quality: existing?.sleep_quality ?? null,
      });
    }
  }

  for (const d of dailySleep) {
    if (!d.day) continue;
    const existing = byDay.get(d.day) ?? { date: d.day, hrv: null, resting_hr: null, sleep_quality: null };
    existing.sleep_quality = scoreToSleepQuality(d.score);
    byDay.set(d.day, existing);
  }

  return [...byDay.values()].filter(
    (r) => r.hrv != null || r.resting_hr != null || r.sleep_quality != null,
  );
}

/** Fetch and map the last `days` of recovery data for an access token. */
export async function ouraFetchRecovery(accessToken: string, days = 30): Promise<RecoveryDay[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const q = `start_date=${fmt(start)}&end_date=${fmt(end)}`;
  const headers = { Authorization: `Bearer ${accessToken}` };

  const [sleepRes, dailyRes] = await Promise.all([
    fetch(`${API}/sleep?${q}`, { headers, cache: "no-store" }),
    fetch(`${API}/daily_sleep?${q}`, { headers, cache: "no-store" }),
  ]);
  if (!sleepRes.ok) throw new Error(`Oura sleep fetch failed (${sleepRes.status})`);

  const sleep = ((await sleepRes.json())?.data ?? []) as OuraSleep[];
  const daily = dailyRes.ok ? (((await dailyRes.json())?.data ?? []) as OuraDailySleep[]) : [];
  return mapOuraToRecovery(sleep, daily);
}
