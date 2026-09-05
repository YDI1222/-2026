import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthUrl } from "@/lib/google";
import { googleEnabled } from "@/lib/env";
import { OAUTH_STATE_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!googleEnabled) {
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  const returnTo = new URL(req.url).searchParams.get("returnTo") ?? "/";
  // CSRF 対策の state に戻り先も載せる（cookie 側と突き合わせる）。
  const nonce = randomBytes(16).toString("base64url");
  const state = `${nonce}.${Buffer.from(returnTo).toString("base64url")}`;

  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
