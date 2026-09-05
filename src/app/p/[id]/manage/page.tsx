import Link from "next/link";
import { notFound } from "next/navigation";
import {
  confirmSlotAction,
  deleteParticipantAction,
  deleteShareTargetAction,
  addShareTargetAction,
  notifyTargetsAction,
  reopenPollAction,
} from "@/app/actions";
import ResultTable from "@/components/ResultTable";
import ShareBar from "@/components/ShareBar";
import { APP_URL, lineEnabled } from "@/lib/env";
import { getPollBundle, listShareTargets, tally } from "@/lib/repo";
import { decisionMessage, inviteMessage, pollUrl } from "@/lib/share";
import { formatRange, formatRangeLong } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "主催者ページ — スキマ" };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ManagePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  const bundle = getPollBundle(id);
  if (!bundle) notFound();
  if (bundle.poll.adminToken !== token) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h1 className="font-bold text-rose-800">主催者用のリンクが正しくありません</h1>
        <p className="mt-2 text-sm text-rose-700">
          作成時に表示されたリンクからアクセスしてください。
        </p>
        <Link href={`/p/${id}`} className="mt-4 inline-block text-brand-600 hover:underline">
          回答ページへ →
        </Link>
      </div>
    );
  }

  const { poll, slots, participants } = bundle;
  const tallies = tally(bundle);
  const url = pollUrl(APP_URL, poll.id);
  const confirmedSlot = slots.find((x) => x.id === poll.confirmedSlotId) ?? null;
  const targets = listShareTargets(poll.id);
  const best = tallies[0] ?? null;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-sm text-slate-500">主催者ページ</p>
        <h1 className="text-2xl font-bold text-slate-900">{poll.title}</h1>
        <Link href={`/p/${poll.id}`} className="text-sm text-brand-600 hover:underline">
          参加者に見えるページを開く →
        </Link>
      </header>

      {notice && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {notice}
        </p>
      )}

      {/* -------------------------------------------------- 参加者を集める */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">1. 回答してもらう</h2>
        <p className="text-sm text-slate-600">
          このリンクを送ります。相手のログインは不要です。
        </p>
        <ShareBar
          text={inviteMessage(poll, url)}
          url={url}
          subject={`【日程調整】${poll.title}`}
          messengerAppId={process.env.NEXT_PUBLIC_FB_APP_ID}
        />
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          いま開いているこのページの URL は主催者専用です。参加者には共有しないでください。
        </p>
      </section>

      {/* ------------------------------------------------------ 集計と確定 */}
      <section className="space-y-4">
        <h2 className="font-semibold text-slate-900">2. 集計と確定</h2>

        {slots.length > 0 && (
          <ResultTable
            bundle={bundle}
            tallies={tallies}
            highlightSlotId={poll.confirmedSlotId ?? best?.slot.id ?? null}
          />
        )}

        {participants.length > 0 && (
          <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer text-slate-600">回答を削除する</summary>
            <ul className="mt-3 space-y-2">
              {participants.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">{p.name}</span>
                  <form action={deleteParticipantAction}>
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="adminToken" value={token} />
                    <input type="hidden" name="participantId" value={p.id} />
                    <button className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
                      削除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}

        {poll.status === "confirmed" && confirmedSlot ? (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm font-medium text-emerald-700">確定しました</p>
            <p className="text-lg font-bold text-emerald-900">
              {formatRangeLong(confirmedSlot.startsAt, confirmedSlot.endsAt, poll.timezone)}
            </p>
            {poll.googleEventLink && (
              <a
                href={poll.googleEventLink}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-emerald-800 underline"
              >
                Google カレンダーの予定を開く
              </a>
            )}
            {poll.meetingUrl && (
              <p className="break-all text-sm text-emerald-900">Meet：{poll.meetingUrl}</p>
            )}

            <form action={reopenPollAction}>
              <input type="hidden" name="pollId" value={poll.id} />
              <input type="hidden" name="adminToken" value={token} />
              <button className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100">
                確定を取り消す（カレンダーの予定も削除）
              </button>
            </form>
          </div>
        ) : (
          <form action={confirmSlotAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <input type="hidden" name="pollId" value={poll.id} />
            <input type="hidden" name="adminToken" value={token} />

            <p className="text-sm text-slate-600">
              確定する日時をえらんでください。
              {best && ` いまのところ ${formatRange(best.slot.startsAt, best.slot.endsAt, poll.timezone)} が最多です。`}
            </p>

            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {tallies.map((t, i) => (
                <li key={t.slot.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                    <input
                      type="radio"
                      name="slotId"
                      value={t.slot.id}
                      defaultChecked={i === 0}
                      required
                      className="size-4 accent-blue-600"
                    />
                    <span className="flex-1 text-sm tabular-nums text-slate-700">
                      {formatRange(t.slot.startsAt, t.slot.endsAt, poll.timezone)}
                    </span>
                    <span className="text-xs text-slate-500">
                      <span className="text-emerald-600">○{t.yes}</span>{" "}
                      <span className="text-amber-600">△{t.maybe}</span>{" "}
                      <span className="text-rose-500">×{t.no}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {poll.accountId ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="addToCalendar"
                    defaultChecked
                    className="size-4 accent-blue-600"
                  />
                  <span className="text-slate-700">
                    Google カレンダーに登録する
                    {poll.onlineProvider === "google_meet" && "（Meet のリンクも発行）"}
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="inviteParticipants"
                    className="size-4 accent-blue-600"
                  />
                  <span className="text-slate-700">
                    メールを入力した参加者を招待する（Google から招待メールが届きます）
                  </span>
                </label>
              </div>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                この調整は Google 未連携で作られたため、カレンダー登録はできません。確定後に
                「Google カレンダーに追加」リンクから手動で入れられます。
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-lg bg-brand-600 px-6 py-2.5 font-medium text-white hover:bg-brand-700"
            >
              この日時で確定する
            </button>
          </form>
        )}
      </section>

      {/* ---------------------------------------------------- 決定を伝える */}
      {poll.status === "confirmed" && confirmedSlot && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">3. 決まったことを伝える</h2>
          <ShareBar
            text={decisionMessage(poll, confirmedSlot, url)}
            url={url}
            subject={`【日程確定】${poll.title}`}
            messengerAppId={process.env.NEXT_PUBLIC_FB_APP_ID}
          />

          <div className="space-y-3 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">
              登録した宛先へ自動送信する（任意）
            </h3>
            <p className="text-xs leading-relaxed text-slate-500">
              LINE 公式アカウント（Messaging API）の宛先 ID か、Slack・Discord などの Webhook URL
              を登録しておくと、ボタン一つで同じ文面を流せます。
              {!lineEnabled && " LINE の送信には LINE_CHANNEL_ACCESS_TOKEN の設定が必要です。"}
            </p>

            {targets.length > 0 && (
              <ul className="space-y-2">
                {targets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-slate-700">
                      <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {t.channel === "line" ? "LINE" : "Webhook"}
                      </span>
                      {t.label || t.target}
                    </span>
                    <form action={deleteShareTargetAction}>
                      <input type="hidden" name="pollId" value={poll.id} />
                      <input type="hidden" name="adminToken" value={token} />
                      <input type="hidden" name="targetId" value={t.id} />
                      <button className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
                        削除
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form action={addShareTargetAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="pollId" value={poll.id} />
              <input type="hidden" name="adminToken" value={token} />
              <select
                name="channel"
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
              >
                <option value="line">LINE</option>
                <option value="webhook">Webhook</option>
              </select>
              <input
                name="target"
                required
                placeholder="LINE の userId / groupId、または https://... "
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                name="label"
                placeholder="表示名"
                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                追加
              </button>
            </form>

            {targets.length > 0 && (
              <form action={notifyTargetsAction}>
                <input type="hidden" name="pollId" value={poll.id} />
                <input type="hidden" name="adminToken" value={token} />
                <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900">
                  登録した宛先すべてに送信
                </button>
              </form>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
