import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentAccount } from "@/lib/session";

export const metadata: Metadata = {
  title: "スキマ — Googleカレンダーと同期する日程調整",
  description:
    "候補日時を出して、投票してもらって、決まったら Google カレンダーに登録。Meet のリンクまで作って、そのまま LINE やメールに送れます。",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const account = await currentAccount();

  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
              <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">
                ス
              </span>
              スキマ
            </Link>

            <div className="flex items-center gap-3 text-sm">
              {account ? (
                <>
                  <span className="hidden text-slate-500 sm:inline">{account.email}</span>
                  <form action="/api/auth/logout" method="post">
                    <button className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
                      ログアウト
                    </button>
                  </form>
                </>
              ) : (
                <a
                  href="/api/auth/google/start"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Google と連携
                </a>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>

        <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-slate-400">
          スキマは候補日時の調整と、確定後の Google カレンダー登録・共有を行います。
        </footer>
      </body>
    </html>
  );
}
