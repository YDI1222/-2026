import { cookies } from "next/headers";
import { getSessionAccount } from "@/lib/repo";
import type { Account } from "@/lib/types";

export const SESSION_COOKIE = "sukima_session";
export const OAUTH_STATE_COOKIE = "sukima_oauth_state";

/** ログイン中の Google アカウント。未ログインなら null。 */
export async function currentAccount(): Promise<Account | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  return getSessionAccount(sid);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  };
}
