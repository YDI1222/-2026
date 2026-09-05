"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APP_URL, DEFAULT_TIMEZONE } from "@/lib/env";
import { createCalendarEvent, deleteCalendarEvent, ensureAccessToken } from "@/lib/google";
import { pushLineText } from "@/lib/notify/line";
import { postWebhook } from "@/lib/notify/webhook";
import * as repo from "@/lib/repo";
import { decisionMessage, manageUrl, pollUrl } from "@/lib/share";
import { currentAccount } from "@/lib/session";
import { parseLocalDateTime } from "@/lib/time";
import type { Answer, LocationMode, OnlineProvider, ShareChannel } from "@/lib/types";

const s = (fd: FormData, key: string): string => String(fd.get(key) ?? "").trim();

/** 主催者用トークンの照合。合わなければ例外にして処理を止める。 */
function assertAdmin(pollId: string, token: string) {
  const poll = repo.getPoll(pollId);
  if (!poll) throw new Error("この調整は見つかりませんでした");
  if (poll.adminToken !== token) throw new Error("主催者用のリンクが正しくありません");
  return poll;
}

/* ------------------------------------------------------------------ 作成 */

export async function createPollAction(formData: FormData) {
  const account = await currentAccount();
  const timezone = s(formData, "timezone") || DEFAULT_TIMEZONE;
  const title = s(formData, "title") || "打ち合わせ";
  const durationMinutes = Math.min(Math.max(Number(s(formData, "durationMinutes")) || 60, 10), 8 * 60);

  const locationMode = (["online", "offline", "hybrid"].includes(s(formData, "locationMode"))
    ? s(formData, "locationMode")
    : "online") as LocationMode;

  const rawProvider = s(formData, "onlineProvider");
  const onlineProvider = (["google_meet", "custom", "none"].includes(rawProvider)
    ? rawProvider
    : "google_meet") as OnlineProvider;

  // "YYYY-MM-DDTHH:mm" の並び。重複と不正値はここで落とす。
  const starts = formData
    .getAll("slot")
    .map((v) => String(v))
    .map((v) => {
      const [date, time] = v.split("T");
      return date && time ? parseLocalDateTime(date, time.slice(0, 5), timezone) : null;
    })
    .filter((v): v is number => v != null);

  if (starts.length === 0) {
    throw new Error("候補の日時を1つ以上えらんでください");
  }

  const poll = repo.createPoll({
    accountId: account?.id ?? null,
    title,
    description: s(formData, "description"),
    organizerName: s(formData, "organizerName") || account?.name || "",
    organizerEmail: account?.email ?? (s(formData, "organizerEmail") || null),
    timezone,
    durationMinutes,
    locationMode,
    onlineProvider: locationMode === "offline" ? "none" : onlineProvider,
    customMeetingUrl: onlineProvider === "custom" ? s(formData, "customMeetingUrl") || null : null,
    offlinePlace: locationMode === "online" ? null : s(formData, "offlinePlace") || null,
    starts,
  });

  redirect(manageUrl("", poll.id, poll.adminToken));
}

/* ------------------------------------------------------------------ 回答 */

export async function saveResponseAction(formData: FormData) {
  const pollId = s(formData, "pollId");
  const bundle = repo.getPollBundle(pollId);
  if (!bundle) throw new Error("この調整は見つかりませんでした");

  const name = s(formData, "name");
  if (!name) throw new Error("お名前を入力してください");

  const answers: Record<string, Answer> = {};
  for (const slot of bundle.slots) {
    const v = s(formData, `answer_${slot.id}`);
    if (v === "yes" || v === "maybe" || v === "no") answers[slot.id] = v;
  }

  const participant = repo.saveResponse({
    pollId,
    participantId: s(formData, "participantId") || null,
    editToken: s(formData, "editToken") || null,
    name,
    comment: s(formData, "comment"),
    email: s(formData, "email") || null,
    answers,
  });

  revalidatePath(`/p/${pollId}`);
  redirect(`/p/${pollId}?me=${participant.id}&t=${encodeURIComponent(participant.editToken)}`);
}

export async function deleteParticipantAction(formData: FormData) {
  const pollId = s(formData, "pollId");
  assertAdmin(pollId, s(formData, "adminToken"));
  repo.deleteParticipant(pollId, s(formData, "participantId"));
  revalidatePath(`/p/${pollId}`);
}

/* ------------------------------------------------------------------ 確定 */

export interface ConfirmResult {
  ok: boolean;
  message: string;
}

export async function confirmSlotAction(formData: FormData): Promise<void> {
  const pollId = s(formData, "pollId");
  const adminToken = s(formData, "adminToken");
  const poll = assertAdmin(pollId, adminToken);
  const slotId = s(formData, "slotId");

  const bundle = repo.getPollBundle(pollId)!;
  const slot = bundle.slots.find((x) => x.id === slotId);
  if (!slot) throw new Error("その候補は見つかりませんでした");

  const wantsCalendar = s(formData, "addToCalendar") === "on";
  const inviteParticipants = s(formData, "inviteParticipants") === "on";

  let googleEventId: string | null = null;
  let googleEventLink: string | null = null;
  let meetingUrl: string | null =
    poll.onlineProvider === "custom" ? poll.customMeetingUrl : null;
  let notice = "";

  if (wantsCalendar && poll.accountId) {
    const accessToken = await ensureAccessToken(poll.accountId);
    if (!accessToken) {
      notice = "Google の連携が切れていたため、カレンダー登録はスキップしました。";
    } else {
      const attendees = inviteParticipants
        ? bundle.participants
            .map((p) => p.email)
            .filter((e): e is string => Boolean(e && e.includes("@")))
        : [];
      const withMeet = poll.locationMode !== "offline" && poll.onlineProvider === "google_meet";

      try {
        const ev = await createCalendarEvent(accessToken, {
          summary: poll.title,
          description: [poll.description, "", `調整ページ：${pollUrl(APP_URL, poll.id)}`]
            .join("\n")
            .trim(),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timeZone: poll.timezone,
          attendeeEmails: attendees,
          withMeet,
          location: poll.locationMode === "online" ? null : poll.offlinePlace,
        });
        googleEventId = ev.id;
        googleEventLink = ev.htmlLink;
        if (ev.meetUrl) meetingUrl = ev.meetUrl;
      } catch (e) {
        notice = `カレンダー登録に失敗しました：${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  repo.confirmPoll(pollId, slotId, { googleEventId, googleEventLink, meetingUrl });
  revalidatePath(`/p/${pollId}`);
  redirect(
    `${manageUrl("", pollId, adminToken)}&confirmed=1${notice ? `&notice=${encodeURIComponent(notice)}` : ""}`,
  );
}

export async function reopenPollAction(formData: FormData) {
  const pollId = s(formData, "pollId");
  const adminToken = s(formData, "adminToken");
  const poll = assertAdmin(pollId, adminToken);

  if (poll.googleEventId && poll.accountId) {
    const accessToken = await ensureAccessToken(poll.accountId);
    if (accessToken) await deleteCalendarEvent(accessToken, poll.googleEventId);
  }
  repo.reopenPoll(pollId);
  revalidatePath(`/p/${pollId}`);
  redirect(manageUrl("", pollId, adminToken));
}

/* -------------------------------------------------------------- 通知先 */

export async function addShareTargetAction(formData: FormData) {
  const pollId = s(formData, "pollId");
  const adminToken = s(formData, "adminToken");
  assertAdmin(pollId, adminToken);

  const channel = (s(formData, "channel") === "webhook" ? "webhook" : "line") as ShareChannel;
  const target = s(formData, "target");
  if (!target) throw new Error("送信先を入力してください");

  repo.addShareTarget({ pollId, channel, target, label: s(formData, "label") });
  redirect(manageUrl("", pollId, adminToken));
}

export async function deleteShareTargetAction(formData: FormData) {
  const pollId = s(formData, "pollId");
  const adminToken = s(formData, "adminToken");
  assertAdmin(pollId, adminToken);
  repo.deleteShareTarget(pollId, s(formData, "targetId"));
  redirect(manageUrl("", pollId, adminToken));
}

/** 登録済みの送信先に、確定内容を push する。 */
export async function notifyTargetsAction(formData: FormData) {
  const pollId = s(formData, "pollId");
  const adminToken = s(formData, "adminToken");
  const poll = assertAdmin(pollId, adminToken);

  const bundle = repo.getPollBundle(pollId)!;
  const slot = bundle.slots.find((x) => x.id === poll.confirmedSlotId);
  if (!slot) throw new Error("先に日程を確定してください");

  const text = decisionMessage(poll, slot, pollUrl(APP_URL, poll.id));
  const targets = repo.listShareTargets(pollId);

  const results: string[] = [];
  for (const t of targets) {
    const r =
      t.channel === "line" ? await pushLineText(t.target, text) : await postWebhook(t.target, text);
    results.push(`${t.label || t.target}：${r.ok ? "送信しました" : r.error}`);
  }

  const notice = results.length ? results.join(" / ") : "送信先が登録されていません";
  redirect(`${manageUrl("", pollId, adminToken)}&notice=${encodeURIComponent(notice)}`);
}
