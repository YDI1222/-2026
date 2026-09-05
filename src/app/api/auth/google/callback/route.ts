import { NextResponse } from "next/server";
import { decodeIdToken, exchangeCode } from "@/lib/google";
import { createSession, upsertAccount } from "@/lib/repo";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error ?? "no_code")}`, req.url));
  }

  const [nonce, encodedReturnTo] = state.split(".");
  const expected = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);

  if (!nonce || nonce !== expected) {
    return NextResponse.redirect(new URL("/?auth_error=state_mismatch", req.url));
  }

  let returnTo = "/";
  try {
    if (encodedReturnTo) returnTo = Buffer.from(encodedReturnTo, "base64url").toString("utf8");
  } catch {
    returnTo = "/";
  }
  // オープンリダイレクト防止：自サイト内のパスのみ許可。
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const token = await exchangeCode(code);
  if (!token.id_token) {
    return NextResponse.redirect(new URL("/?auth_error=no_id_token", req.url));
  }

  const info = decodeIdToken(token.id_token);
  const account = upsertAccount({
    googleSub: info.sub,
    email: info.email,
    name: info.name,
    picture: info.picture,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? "",
  });

  const sid = createSession(account.id);
  const res = NextResponse.redirect(new URL(returnTo, req.url));
  res.cookies.set(SESSION_COOKIE, sid, sessionCookieOptions());
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
