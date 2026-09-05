import { notFound } from "next/navigation";
import ResultTable from "@/components/ResultTable";
import ShareBar from "@/components/ShareBar";
import VoteForm from "@/components/VoteForm";
import { APP_URL } from "@/lib/env";
import { getPollBundle, tally } from "@/lib/repo";
import {
  decisionMessage,
  googleCalendarTemplateUrl,
  inviteMessage,
  pollUrl,
} from "@/lib/share";
import { formatRange, formatRangeLong } from "@/lib/time";
import type { Answer } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const bundle = getPollBundle(id);
  return { title: bundle ? `${bundle.poll.title} — スキマ` : "見つかりません — スキマ" };
}

export default async function PollPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const bundle = getPollBundle(id);
  if (!bundle) notFound();

  const { poll, slots, participants, votes } = bundle;
  const tallies = tally(bundle);
  const url = pollUrl(APP_URL, poll.id);

  const meId = typeof sp.me === "string" ? sp.me : null;
  const meToken = typeof sp.t === "string" ? sp.t : null;
  const me = participants.find((p) => p.id === meId && p.editToken === meToken) ?? null;
  const myAnswers: Record<string, Answer> = {};
  if (me) {
    for (const v of votes.filter((v) => v.participantId === me.id)) {
      myAnswers[v.slotId] = v.answer;
    }
  }

  const confirmedSlot = slots.find((x) => x.id === poll.confirmedSlotId) ?? null;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">{poll.title}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              poll.status === "confirmed"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {poll.status === "confirmed" ? "確定ずみ" : "調整中"}
          </span>
        </div>
        {poll.description && (
          <p className="whitespace-pre-wrap text-slate-600">{poll.description}</p>
        )}
        <p className="text-sm text-slate-500">
          {poll.organizerName && `主催：${poll.organizerName}・`}
          所要 {poll.durationMinutes} 分・
          {poll.locationMode === "offline"
            ? "対面"
            : poll.locationMode === "hybrid"
              ? "オンライン＋対面"
              : "オンライン"}
          ・{poll.timezone}
        </p>
      </header>

      {/* ------------------------------------------------------ 確定した内容 */}
      {confirmedSlot && (
        <section className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div>
            <p className="text-sm font-medium text-emerald-700">この日程で決まりました</p>
            <p className="mt-1 text-lg font-bold text-emerald-900">
              {formatRangeLong(confirmedSlot.startsAt, confirmedSlot.endsAt, poll.timezone)}
            </p>
          </div>

          {poll.meetingUrl && (
            <a
              href={poll.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              {poll.onlineProvider === "google_meet" ? "Google Meet に参加" : "会議リンクを開く"}
            </a>
          )}
          {poll.offlinePlace && (
            <p className="text-sm text-emerald-900">会場：{poll.offlinePlace}</p>
          )}

          <ShareBar
            text={decisionMessage(poll, confirmedSlot, url)}
            url={url}
            subject={`【日程確定】${poll.title}`}
            messengerAppId={process.env.NEXT_PUBLIC_FB_APP_ID}
            calendarUrl={googleCalendarTemplateUrl({
              title: poll.title,
              details: poll.meetingUrl ? `${poll.description}\n${poll.meetingUrl}` : poll.description,
              location: poll.meetingUrl ?? poll.offlinePlace ?? "",
              startsAt: confirmedSlot.startsAt,
              endsAt: confirmedSlot.endsAt,
            })}
          />
        </section>
      )}

      {/* ---------------------------------------------------------- 集計表 */}
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">
          みんなの回答（{participants.length}人）
        </h2>
        {slots.length > 0 && (
          <ResultTable
            bundle={bundle}
            tallies={tallies}
            highlightSlotId={poll.confirmedSlotId ?? tallies[0]?.slot.id ?? null}
          />
        )}
        {participants.length === 0 && (
          <p className="text-sm text-slate-500">まだ回答がありません。最初の1人になりましょう。</p>
        )}
      </section>

      {/* ---------------------------------------------------------- 回答欄 */}
      {poll.status !== "confirmed" && (
        <VoteForm
          pollId={poll.id}
          slots={slots.map((s) => ({
            id: s.id,
            label: formatRange(s.startsAt, s.endsAt, poll.timezone),
          }))}
          askEmail={poll.locationMode !== "offline"}
          initial={
            me
              ? {
                  participantId: me.id,
                  editToken: me.editToken,
                  name: me.name,
                  comment: me.comment,
                  email: me.email,
                  answers: myAnswers,
                }
              : null
          }
        />
      )}

      {/* ------------------------------------------------ 参加者集めの共有 */}
      {poll.status !== "confirmed" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">このページを共有する</h2>
          <ShareBar
            text={inviteMessage(poll, url)}
            url={url}
            subject={`【日程調整】${poll.title}`}
            messengerAppId={process.env.NEXT_PUBLIC_FB_APP_ID}
          />
        </section>
      )}
    </div>
  );
}
