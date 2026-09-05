import { APP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "@/lib/env";
import { getAccount, updateAccountTokens } from "@/lib/repo";
import type { Account } from "@/lib/types";

/**
 * googleapis パッケージ（数十 MB）を入れず、必要な 4 本のエンドポイントだけを
 * fetch で叩く。依存が減るぶん、何を送っているかが読んで分かる。
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * 最小権限で要求する。
 * - calendar.events   : 予定の作成／更新（確定した予定を入れるため）
 * - calendar.freebusy : 空き／予定ありの時間帯だけを読む（予定の中身は読まない）
 * calendar.readonly を要求すれば予定名まで読めるが、日程調整には不要。
 */
export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export const redirectUri = () => `${APP_URL}/api/auth/google/callback`;

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    // refresh_token を確実に受け取るための組み合わせ。
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  token_type: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

/** id_token の payload を読む。署名検証は Google からの直接応答なので省略。 */
export function decodeIdToken(idToken: string): GoogleUserInfo {
  const payload = idToken.split(".")[1];
  const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  return {
    sub: String(json.sub ?? ""),
    email: String(json.email ?? ""),
    name: String(json.name ?? json.email ?? ""),
    picture: json.picture ? String(json.picture) : null,
  };
}

/** 期限切れが近ければ refresh する。使える access token を返す。 */
export async function ensureAccessToken(accountId: string): Promise<string | null> {
  const account = getAccount(accountId);
  if (!account?.accessToken) return null;

  // 60 秒の余裕を見て前倒しで更新する。
  if (account.expiresAt - 60_000 > Date.now()) return account.accessToken;
  if (!account.refreshToken) return null;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;

  const token = (await res.json()) as TokenResponse;
  const expiresAt = Date.now() + token.expires_in * 1000;
  updateAccountTokens(accountId, token.access_token, expiresAt, token.refresh_token ?? null);
  return token.access_token;
}

export async function revokeToken(account: Account): Promise<void> {
  const token = account.refreshToken ?? account.accessToken;
  if (!token) return;
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

/* ------------------------------------------------------------- free/busy */

export interface BusyRange {
  start: number;
  end: number;
}

export async function fetchBusy(
  accessToken: string,
  timeMinMs: number,
  timeMaxMs: number,
  calendarIds: string[] = ["primary"],
): Promise<BusyRange[]> {
  const res = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: new Date(timeMinMs).toISOString(),
      timeMax: new Date(timeMaxMs).toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  if (!res.ok) throw new Error(`freeBusy failed: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const out: BusyRange[] = [];
  for (const cal of Object.values(json.calendars ?? {})) {
    for (const b of cal.busy ?? []) {
      out.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- events */

export interface CreatedEvent {
  id: string;
  htmlLink: string | null;
  meetUrl: string | null;
}

export async function createCalendarEvent(
  accessToken: string,
  input: {
    summary: string;
    description: string;
    startsAt: number;
    endsAt: number;
    timeZone: string;
    attendeeEmails: string[];
    /** true なら Google Meet のリンクを自動発行させる。 */
    withMeet: boolean;
    location?: string | null;
  },
): Promise<CreatedEvent> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: new Date(input.startsAt).toISOString(), timeZone: input.timeZone },
    end: { dateTime: new Date(input.endsAt).toISOString(), timeZone: input.timeZone },
  };
  if (input.location) body.location = input.location;
  if (input.attendeeEmails.length > 0) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }));
  }
  if (input.withMeet) {
    body.conferenceData = {
      createRequest: {
        // 冪等キー。同じ requestId で再送しても会議が二重に作られない。
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const params = new URLSearchParams({
    conferenceDataVersion: input.withMeet ? "1" : "0",
    sendUpdates: input.attendeeEmails.length > 0 ? "all" : "none",
  });

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`event create failed: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as {
    id: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  };
  const entry = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  return {
    id: json.id,
    htmlLink: json.htmlLink ?? null,
    meetUrl: json.hangoutLink ?? entry?.uri ?? null,
  };
}

export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  await fetch(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}
