import { formatRangeLong } from "@/lib/time";
import type { Poll, Slot } from "@/lib/types";

/**
 * ここはサーバ／クライアント両方から呼ぶので Node 依存を持ち込まない。
 *
 * 設計上の割り切り：LINE / Messenger への「自動送信」は各社の API 審査と
 * 送信上限が前提になる。まずは審査不要の「ワンタップ共有」を既定にして、
 * 公式アカウントを持っている人だけが push を足せる形にしている。
 */

export function pollUrl(baseUrl: string, pollId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/p/${pollId}`;
}

export function manageUrl(baseUrl: string, pollId: string, adminToken: string): string {
  return `${baseUrl.replace(/\/$/, "")}/p/${pollId}/manage?t=${encodeURIComponent(adminToken)}`;
}

/** 参加者を集める段階のメッセージ。 */
export function inviteMessage(poll: Poll, url: string): string {
  const lines = [
    `【日程調整のお願い】${poll.title}`,
    "",
    "下のリンクから、参加できる日時に○×をつけてください。",
    url,
  ];
  if (poll.description.trim()) {
    lines.splice(2, 0, poll.description.trim(), "");
  }
  return lines.join("\n");
}

/** 確定後のメッセージ。Meet の URL はここに載る。 */
export function decisionMessage(poll: Poll, slot: Slot, url: string): string {
  const lines: string[] = [
    `【日程が決まりました】${poll.title}`,
    "",
    `📅 ${formatRangeLong(slot.startsAt, slot.endsAt, poll.timezone)}`,
  ];

  if (poll.locationMode === "offline") {
    lines.push(`📍 ${poll.offlinePlace?.trim() || "会場は別途ご案内します"}`);
  } else if (poll.meetingUrl) {
    const label = poll.onlineProvider === "google_meet" ? "オンライン（Google Meet）" : "オンライン";
    lines.push(`📍 ${label}`);
    lines.push(`🔗 ${poll.meetingUrl}`);
    if (poll.locationMode === "hybrid" && poll.offlinePlace?.trim()) {
      lines.push(`🏢 会場もあります：${poll.offlinePlace.trim()}`);
    }
  } else {
    // リンクがまだ無い状態で「Google Meet」と書くと、受け取った側が探してしまう。
    lines.push("📍 オンライン（会議リンクは追ってお送りします）");
    if (poll.locationMode === "hybrid" && poll.offlinePlace?.trim()) {
      lines.push(`🏢 会場：${poll.offlinePlace.trim()}`);
    }
  }

  lines.push("", `詳細：${url}`);
  return lines.join("\n");
}

/* ------------------------------------------------- 各サービスへの共有リンク */

/**
 * LINE の URL スキーム。text だけを渡すと送信先を LINE 側で選ばせられるため、
 * トークルーム／グループを問わず貼り付けられる。
 */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

/**
 * Messenger。モバイルはアプリの共有ダイアログ、
 * PC ブラウザは Facebook の send ダイアログ（app_id が必要）を使う。
 */
export function messengerShareUrl(link: string, appId?: string): string {
  if (appId) {
    const params = new URLSearchParams({ link, app_id: appId });
    return `https://www.facebook.com/dialog/send?${params.toString()}`;
  }
  return `fb-messenger://share?link=${encodeURIComponent(link)}`;
}

export function mailtoUrl(subject: string, body: string, to = ""): string {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(to)}?${params.toString().replace(/\+/g, "%20")}`;
}

/** Google カレンダーに「予定を追加」する汎用リンク（連携していない参加者向け）。 */
export function googleCalendarTemplateUrl(input: {
  title: string;
  details: string;
  location: string;
  startsAt: number;
  endsAt: number;
}): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    details: input.details,
    location: input.location,
    dates: `${stamp(input.startsAt)}/${stamp(input.endsAt)}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
