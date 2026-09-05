import { LINE_CHANNEL_ACCESS_TOKEN, lineEnabled } from "@/lib/env";

/**
 * LINE 公式アカウント（Messaging API）からの push 送信。
 *
 * 前提：LINE Notify は 2025-03-31 に終了しており、後継は Messaging API。
 * push には「LINE 公式アカウントの開設」と「送信先が友だち登録済みであること」、
 * そしてプランごとの無料通数上限が伴う。設定されていなければ静かに無効化する。
 */

const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export interface PushResult {
  ok: boolean;
  /** 失敗理由（UI にそのまま出せる日本語）。成功時は null。 */
  error: string | null;
}

export async function pushLineText(to: string, text: string): Promise<PushResult> {
  if (!lineEnabled) {
    return { ok: false, error: "LINE 連携が未設定です（LINE_CHANNEL_ACCESS_TOKEN）" };
  }

  const res = await fetch(PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    // 1 通あたり 5,000 文字が上限。日程通知では超えないが安全側で切る。
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  }).catch(() => null);

  if (!res) return { ok: false, error: "LINE への接続に失敗しました" };
  if (res.ok) return { ok: true, error: null };

  const detail = await res.text().catch(() => "");
  if (res.status === 429) {
    return { ok: false, error: "LINE の無料送信数の上限に達しています（429）" };
  }
  return { ok: false, error: `LINE 送信に失敗しました（${res.status}）${detail.slice(0, 200)}` };
}
