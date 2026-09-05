"use client";

import { useState, useTransition } from "react";
import { createPollAction } from "@/app/actions";

interface Props {
  connected: boolean;
  defaultOrganizerName: string;
  timezone: string;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-09-12T14:00" を "9/12(金) 14:00" に。表示専用。 */
function pretty(value: string): string {
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${wd}) ${time}`;
}

export default function PollForm({ connected, defaultOrganizerName, timezone }: Props) {
  const [slots, setSlots] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [locationMode, setLocationMode] = useState<"online" | "offline" | "hybrid">("online");
  const [onlineProvider, setOnlineProvider] = useState<"google_meet" | "custom">("google_meet");
  const [duration, setDuration] = useState(60);

  const [days, setDays] = useState(14);
  const [startHour, setStartHour] = useState(10);
  const [endHour, setEndHour] = useState(18);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [suggestMessage, setSuggestMessage] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const addSlot = (value: string) => {
    if (!value) return;
    const normalized = value.slice(0, 16);
    setSlots((prev) => (prev.includes(normalized) ? prev : [...prev, normalized].sort()));
  };

  const suggest = () => {
    setSuggestMessage(null);
    startLoading(async () => {
      const params = new URLSearchParams({
        tz: timezone,
        duration: String(duration),
        days: String(days),
        startHour: String(startHour),
        endHour: String(endHour),
        weekdays: weekdays.join(","),
        limit: "8",
      });
      const res = await fetch(`/api/suggest?${params}`);
      const json = (await res.json()) as { slots: string[]; message: string | null };
      setSlots((prev) => [...new Set([...prev, ...json.slots])].sort());
      setSuggestMessage(json.message ?? null);
    });
  };

  const toggleWeekday = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  return (
    <form action={createPollAction} className="space-y-8">
      <input type="hidden" name="timezone" value={timezone} />
      {slots.map((v) => (
        <input key={v} type="hidden" name="slot" value={v} />
      ))}

      {/* --------------------------------------------------------- 基本情報 */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">1. 何の予定ですか</h2>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">タイトル</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder="例：新サービスの打ち合わせ"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">補足（任意）</span>
          <textarea
            name="description"
            rows={2}
            maxLength={1000}
            placeholder="例：オンラインで30分ほど、資料の共有もします"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">主催者名</span>
            <input
              name="organizerName"
              defaultValue={defaultOrganizerName}
              maxLength={60}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">所要時間</span>
            <select
              name="durationMinutes"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-500"
            >
              {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m}分` : `${m / 60}時間`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* --------------------------------------------------------- 実施方法 */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">2. どこでやりますか</h2>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["online", "オンライン"],
              ["offline", "対面"],
              ["hybrid", "両方"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border px-4 py-2 text-sm ${
                locationMode === value
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="locationMode"
                value={value}
                checked={locationMode === value}
                onChange={() => setLocationMode(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>

        {locationMode !== "offline" && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["google_meet", "Google Meet を自動発行"],
                  ["custom", "自分で URL を指定"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                    onlineProvider === value
                      ? "border-brand-500 bg-white text-brand-700"
                      : "border-slate-300 bg-white text-slate-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="onlineProvider"
                    value={value}
                    checked={onlineProvider === value}
                    onChange={() => setOnlineProvider(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>

            {onlineProvider === "google_meet" && !connected && (
              <p className="text-sm text-amber-700">
                Meet のリンクを自動で作るには Google 連携が必要です。未連携のままでも作成でき、
                あとから連携すれば確定時に発行されます。
              </p>
            )}

            {onlineProvider === "custom" && (
              <input
                name="customMeetingUrl"
                type="url"
                placeholder="https://zoom.us/j/... など"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
              />
            )}
          </div>
        )}

        {locationMode !== "online" && (
          <input
            name="offlinePlace"
            maxLength={200}
            placeholder="会場・住所（例：渋谷オフィス 3F 会議室A）"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        )}
      </section>

      {/* --------------------------------------------------------- 候補日時 */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">3. 候補の日時</h2>

        <div className="space-y-3 rounded-lg bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">Google カレンダーの空きから作る</p>
            <button
              type="button"
              onClick={suggest}
              disabled={loading || !connected}
              className="shrink-0 rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? "探しています…" : "候補を自動作成"}
            </button>
          </div>

          {!connected && (
            <p className="text-sm text-slate-500">
              <a href="/api/auth/google/start?returnTo=%2Fnew" className="text-brand-600 underline">
                Google と連携
              </a>
              すると、予定の入っていない時間だけを候補にできます。
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">今後</span>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
              >
                {[7, 14, 21, 30].map((d) => (
                  <option key={d} value={d}>
                    {d}日間
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">開始時刻から</span>
              <select
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">終了時刻まで</span>
              <select
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
              >
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, d) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleWeekday(d)}
                className={`size-9 rounded-lg border text-sm ${
                  weekdays.includes(d)
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {suggestMessage && <p className="text-sm text-amber-700">{suggestMessage}</p>}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-sm text-slate-600">手で追加する</span>
            <input
              type="datetime-local"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              addSlot(draft);
              setDraft("");
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            追加
          </button>
        </div>

        {slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
            候補がまだありません
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {slots.map((v) => (
              <li
                key={v}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-1.5 text-sm"
              >
                <span className="tabular-nums text-slate-700">{pretty(v)}</span>
                <button
                  type="button"
                  onClick={() => setSlots((prev) => prev.filter((x) => x !== v))}
                  aria-label={`${pretty(v)} を削除`}
                  className="grid size-5 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="submit"
        disabled={slots.length === 0}
        className="w-full rounded-lg bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        調整ページをつくる
      </button>
    </form>
  );
}
