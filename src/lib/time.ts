/**
 * タイムゾーン計算はライブラリを足さず Intl だけで完結させている。
 * 保存はすべて epoch ミリ秒（UTC）、表示のときだけ poll.timezone を当てる。
 */

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(utcMs: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // 一部の実装は 0 時を "24" として返すため正規化する。
  const hour = out.hour === 24 ? 0 : out.hour;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour,
    minute: out.minute,
    second: out.second,
  };
}

/** 指定時刻における、そのタイムゾーンの UTC からのオフセット（ミリ秒）。 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = partsInZone(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

/**
 * 「そのタイムゾーンでの壁掛け時計の時刻」を epoch ミリ秒に変換する。
 * DST の切り替わりをまたぐ場合に備えて 2 回収束させる。
 */
export function zonedTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = naive - zoneOffsetMs(naive, timeZone);
  ts = naive - zoneOffsetMs(ts, timeZone);
  return ts;
}

/** "2026-09-12" と "14:00" を epoch ミリ秒へ。パースできなければ null。 */
export function parseLocalDateTime(
  date: string,
  time: string,
  timeZone: string,
): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  if (hour > 23 || minute > 59) return null;
  return zonedTimeToEpoch(Number(d[1]), Number(d[2]), Number(d[3]), hour, minute, timeZone);
}

/** "2026-09-12" 形式（そのタイムゾーンでの日付）。 */
export function toDateKey(utcMs: number, timeZone: string): string {
  const p = partsInZone(utcMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "9/12(金)" */
export function formatDate(utcMs: number, timeZone: string): string {
  const p = partsInZone(utcMs, timeZone);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(utcMs),
  );
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  const jp = index >= 0 ? WEEKDAY_JA[index] : "";
  return `${p.month}/${p.day}(${jp})`;
}

/** "14:00" */
export function formatTime(utcMs: number, timeZone: string): string {
  const p = partsInZone(utcMs, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "9/12(金) 14:00〜15:00" */
export function formatRange(startsAt: number, endsAt: number, timeZone: string): string {
  return `${formatDate(startsAt, timeZone)} ${formatTime(startsAt, timeZone)}〜${formatTime(endsAt, timeZone)}`;
}

/** "2026年9月12日(金) 14:00〜15:00" — 確定通知など、単体で読ませたい場面用。 */
export function formatRangeLong(startsAt: number, endsAt: number, timeZone: string): string {
  const p = partsInZone(startsAt, timeZone);
  const wd = formatDate(startsAt, timeZone).replace(/^\d+\/\d+/, "");
  return `${p.year}年${p.month}月${p.day}日${wd} ${formatTime(startsAt, timeZone)}〜${formatTime(endsAt, timeZone)}`;
}

/** Google Calendar API に渡す RFC3339（UTC 表記）。 */
export function toRfc3339(utcMs: number): string {
  return new Date(utcMs).toISOString();
}

/** ブラウザ側 <input type="datetime-local"> の値を作るためのヘルパ。 */
export function toDatetimeLocalValue(utcMs: number, timeZone: string): string {
  const p = partsInZone(utcMs, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export interface BusyRange {
  start: number;
  end: number;
}

export interface SuggestOptions {
  /** 探索開始（epoch ms）。 */
  from: number;
  /** 探索終了（epoch ms）。 */
  to: number;
  durationMinutes: number;
  /** 就業時間の開始・終了（そのタイムゾーンでの時・分）。 */
  workdayStartHour: number;
  workdayEndHour: number;
  /** 0=日曜。含める曜日。 */
  weekdays: number[];
  /** 候補の刻み（分）。 */
  stepMinutes: number;
  timeZone: string;
  busy: BusyRange[];
  limit: number;
}

/**
 * Google カレンダーの busy 情報を差し引いて、空いている候補枠を列挙する。
 * 「1 日に候補が集中しすぎない」ように 1 日あたり最大 3 件までに間引く。
 */
export function suggestSlots(opts: SuggestOptions): number[] {
  const durationMs = opts.durationMinutes * 60_000;
  const stepMs = Math.max(5, opts.stepMinutes) * 60_000;
  const busy = [...opts.busy].sort((a, b) => a.start - b.start);
  const allowedDays = new Set(opts.weekdays);

  const overlapsBusy = (start: number, end: number) =>
    busy.some((b) => b.start < end && start < b.end);

  const results: number[] = [];
  const perDay = new Map<string, number>();

  // 探索開始を刻み幅に切り上げる。
  let cursor = Math.ceil(opts.from / stepMs) * stepMs;

  while (cursor + durationMs <= opts.to && results.length < opts.limit) {
    const end = cursor + durationMs;
    const p = partsInZone(cursor, opts.timeZone);
    const endP = partsInZone(end, opts.timeZone);
    const localWeekday = weekdayInZone(cursor, opts.timeZone);

    const withinWorkday =
      p.hour >= opts.workdayStartHour &&
      (endP.hour < opts.workdayEndHour ||
        (endP.hour === opts.workdayEndHour && endP.minute === 0));
    const sameDay = toDateKey(cursor, opts.timeZone) === toDateKey(end - 1, opts.timeZone);

    if (allowedDays.has(localWeekday) && withinWorkday && sameDay && !overlapsBusy(cursor, end)) {
      const key = toDateKey(cursor, opts.timeZone);
      const count = perDay.get(key) ?? 0;
      if (count < 3) {
        results.push(cursor);
        perDay.set(key, count + 1);
        // 同じ日に候補を詰めすぎないよう 1 時間飛ばす。
        cursor += Math.max(stepMs, 60 * 60_000);
        continue;
      }
    }
    cursor += stepMs;
  }
  return results;
}

/** そのタイムゾーンでの曜日（0=日曜）。 */
export function weekdayInZone(utcMs: number, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(utcMs),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}
