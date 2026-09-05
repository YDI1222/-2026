"use client";

import { useState } from "react";
import { lineShareUrl, mailtoUrl, messengerShareUrl } from "@/lib/share";

interface Props {
  /** 共有する文面（本文）。 */
  text: string;
  /** 共有するリンク。Messenger は本文ではなくリンクを扱う。 */
  url: string;
  subject: string;
  /** Facebook アプリ ID。あれば PC ブラウザでも Messenger ダイアログが開く。 */
  messengerAppId?: string;
  /** 「Google カレンダーに追加」リンク（参加者向け）。 */
  calendarUrl?: string | null;
}

export default function ShareBar({ text, url, subject, messengerAppId, calendarUrl }: Props) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const canWebShare = typeof navigator !== "undefined" && "share" in navigator;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };

  const share = async () => {
    try {
      await navigator.share({ title: subject, text, url });
    } catch {
      /* ユーザーがキャンセルした場合は何もしない */
    }
  };

  const btn =
    "rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canWebShare && (
          <button type="button" onClick={share} className={`${btn} border-brand-500 text-brand-700`}>
            送る（アプリを選ぶ）
          </button>
        )}
        <button type="button" onClick={copy} className={btn}>
          {copied === "done" ? "コピーしました" : copied === "failed" ? "コピーできません" : "文面をコピー"}
        </button>
        <a href={lineShareUrl(text)} target="_blank" rel="noreferrer" className={btn}>
          LINE で送る
        </a>
        <a
          href={messengerShareUrl(url, messengerAppId)}
          target="_blank"
          rel="noreferrer"
          className={btn}
        >
          Messenger で送る
        </a>
        <a href={mailtoUrl(subject, text)} className={btn}>
          メールで送る
        </a>
        {calendarUrl && (
          <a href={calendarUrl} target="_blank" rel="noreferrer" className={btn}>
            Google カレンダーに追加
          </a>
        )}
      </div>

      <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        {text}
      </pre>

      {!canWebShare && (
        <p className="text-xs text-slate-400">
          スマートフォンで開くと「送る（アプリを選ぶ）」から、入っているアプリへ直接渡せます。
        </p>
      )}
    </div>
  );
}
