import { NextResponse } from "next/server";
import { DEFAULT_TIMEZONE } from "@/lib/env";
import { ensureAccessToken, fetchBusy } from "@/lib/google";
import { currentAccount } from "@/lib/session";
import { suggestSlots, toDatetimeLocalValue } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google カレンダーの busy 情報を読んで、空いている候補枠を返す。
 * 未連携なら「連携が必要」と伝えるだけで、勝手に適当な候補は返さない。
 */
export async function GET(req: Request) {
  const account = await currentAccount();
  if (!account) {
    return NextResponse.json(
      { connected: false, slots: [], message: "Google と連携すると空き時間から候補を作れます" },
      { status: 200 },
    );
  }

  const accessToken = await ensureAccessToken(account.id);
  if (!accessToken) {
    return NextResponse.json(
      { connected: false, slots: [], message: "Google の連携が切れています。もう一度連携してください" },
      { status: 200 },
    );
  }

  const q = new URL(req.url).searchParams;
  const timeZone = q.get("tz") || DEFAULT_TIMEZONE;
  const durationMinutes = clamp(Number(q.get("duration")) || 60, 10, 480);
  const days = clamp(Number(q.get("days")) || 14, 1, 60);
  const workdayStartHour = clamp(Number(q.get("startHour")) || 10, 0, 23);
  const workdayEndHour = clamp(Number(q.get("endHour")) || 18, 1, 24);
  const weekdays = (q.get("weekdays") || "1,2,3,4,5")
    .split(",")
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6);

  // 「今から」ではなく「次の 30 分の切りのいい時刻から」探す。
  const from = Math.ceil(Date.now() / (30 * 60_000)) * (30 * 60_000);
  const to = from + days * 24 * 60 * 60_000;

  let busy: { start: number; end: number }[] = [];
  try {
    busy = await fetchBusy(accessToken, from, to);
  } catch (e) {
    return NextResponse.json(
      {
        connected: true,
        slots: [],
        message: `カレンダーの読み取りに失敗しました：${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 200 },
    );
  }

  const starts = suggestSlots({
    from,
    to,
    durationMinutes,
    workdayStartHour,
    workdayEndHour,
    weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5],
    stepMinutes: 30,
    timeZone,
    busy,
    limit: clamp(Number(q.get("limit")) || 8, 1, 30),
  });

  return NextResponse.json({
    connected: true,
    busyCount: busy.length,
    slots: starts.map((ms) => toDatetimeLocalValue(ms, timeZone)),
    message: starts.length === 0 ? "条件に合う空きが見つかりませんでした。期間や時間帯を広げてみてください" : null,
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
