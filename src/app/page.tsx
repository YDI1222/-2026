import Link from "next/link";
import { googleEnabled } from "@/lib/env";
import { listPollsByAccount } from "@/lib/repo";
import { currentAccount } from "@/lib/session";
import { formatRange } from "@/lib/time";
import { getPollBundle } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const account = await currentAccount();
  const polls = account ? listPollsByAccount(account.id) : [];

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          候補を出す → 決まる → カレンダーに入る、を一続きに
        </h1>
        <p className="text-slate-600">
          Google カレンダーの空き時間から候補を作り、参加者に○×をつけてもらい、確定したら
          Google Meet のリンク付きで予定を登録します。決定した内容は LINE
          やメールにそのまま貼れる形で出てきます。
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/new"
            className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            日程調整をつくる
          </Link>
          {!account && googleEnabled && (
            <a
              href="/api/auth/google/start?returnTo=%2Fnew"
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Google と連携してはじめる
            </a>
          )}
          {!googleEnabled && (
            <Link
              href="/setup"
              className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-2.5 font-medium text-amber-800 hover:bg-amber-100"
            >
              Google 連携の設定手順
            </Link>
          )}
        </div>

        {!googleEnabled && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Google の認証情報が未設定のため、いまは「カレンダー連携なしの日程調整」だけが動きます。
            候補の自動抽出と Meet リンクの発行には設定が必要です。
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "空きから候補を出す",
            body: "自分のカレンダーの予定を避けて、候補日時を自動で並べます。読むのは空き／予定ありだけで、予定の中身は取得しません。",
          },
          {
            title: "○△×で集める",
            body: "参加者はログイン不要。リンクを開いて名前と○×を入れるだけです。",
          },
          {
            title: "決めたら即共有",
            body: "確定すると Google カレンダーに登録し、Meet の URL を含む文面を作ります。LINE・メールにワンタップで送れます。",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 font-semibold text-slate-900">{card.title}</h2>
            <p className="text-sm leading-relaxed text-slate-600">{card.body}</p>
          </div>
        ))}
      </section>

      {account && (
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">つくった調整</h2>
          {polls.length === 0 ? (
            <p className="text-sm text-slate-500">まだありません。</p>
          ) : (
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {polls.map((poll) => {
                const bundle = getPollBundle(poll.id);
                const confirmed = bundle?.slots.find((x) => x.id === poll.confirmedSlotId);
                return (
                  <li key={poll.id}>
                    <Link
                      href={`/p/${poll.id}/manage?t=${encodeURIComponent(poll.adminToken)}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{poll.title}</div>
                        <div className="text-xs text-slate-500">
                          {confirmed
                            ? `確定：${formatRange(confirmed.startsAt, confirmed.endsAt, poll.timezone)}`
                            : `候補 ${bundle?.slots.length ?? 0} 件・回答 ${bundle?.participants.length ?? 0} 人`}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${
                          poll.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {poll.status === "confirmed" ? "確定" : "調整中"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
