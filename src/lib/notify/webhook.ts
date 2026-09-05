/**
 * 汎用 Webhook 通知。Slack / Discord / Chatwork など「JSON を POST すれば
 * 投稿できる」タイプの連携先を、追加実装なしで受けられるようにしておく。
 */
export async function postWebhook(url: string, text: string): Promise<{ ok: boolean; error: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Webhook の URL が不正です" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Webhook は https のみ許可しています" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Slack は text、Discord は content を見る。両方入れておけば大抵通る。
    body: JSON.stringify({ text, content: text }),
  }).catch(() => null);

  if (!res) return { ok: false, error: "Webhook への接続に失敗しました" };
  if (!res.ok) return { ok: false, error: `Webhook が ${res.status} を返しました` };
  return { ok: true, error: null };
}
