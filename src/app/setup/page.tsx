import Link from "next/link";

export const metadata = { title: "設定手順 — スキマ" };

const steps: { title: string; body: string[] }[] = [
  {
    title: "1. Google Cloud でプロジェクトをつくる",
    body: [
      "Google Cloud Console でプロジェクトを新規作成します。",
      "「API とサービス」→「ライブラリ」から Google Calendar API を有効化します。",
    ],
  },
  {
    title: "2. OAuth 同意画面を設定する",
    body: [
      "ユーザーの種類は、社内だけで使うなら「内部」、それ以外は「外部」を選びます。",
      "スコープに calendar.events と calendar.freebusy を追加します。",
      "「外部」かつテスト中の状態では、テストユーザーに登録したアカウントしかログインできません。一般公開するには Google の審査が必要です。",
    ],
  },
  {
    title: "3. OAuth クライアント ID を発行する",
    body: [
      "種類は「ウェブアプリケーション」を選びます。",
      "承認済みのリダイレクト URI に http://localhost:3000/api/auth/google/callback を追加します（本番では自分のドメインに置き換えます）。",
    ],
  },
  {
    title: "4. .env.local に書く",
    body: [
      "GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET、APP_URL を設定して開発サーバーを再起動します。",
      "リポジトリの .env.example をコピーすると早いです。",
    ],
  },
];

export default function SetupPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Google 連携の設定</h1>
        <p className="mt-2 text-slate-600">
          カレンダー連携なしでも日程調整は動きます。空き時間からの候補作成と Google Meet
          リンクの自動発行を使いたい場合だけ、以下の設定が必要です。
        </p>
      </div>

      <ol className="space-y-5">
        {steps.map((step) => (
          <li key={step.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">{step.title}</h2>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-600">
              {step.body.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-slate-300">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">LINE / Messenger への自動送信について</p>
        <p className="mt-2 leading-relaxed">
          「決まった瞬間に、やり取りしているトークへ自動で流す」には、LINE は公式アカウントと
          Messaging API、Messenger は Facebook ページと Messenger Platform の審査が要ります。
          設定なしで使えるのは、確定文面をワンタップで共有する方法です。どちらも用意してあります。
        </p>
      </div>

      <Link href="/new" className="inline-block text-brand-600 hover:underline">
        設定は後回しにして、まず作ってみる →
      </Link>
    </div>
  );
}
