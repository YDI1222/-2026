# つくる前に確かめたこと（既存サービス調査）

最終更新：2026-09-05

「Google カレンダーと同期する日程調整アプリ」は、すでにある機能で足りるのか。
先にそこを潰さないと、作ったあとで「Google の標準機能で十分だった」となりかねません。
結論を先に書きます。

---

## 結論：**用途がずれているので、作る意味はある**

| 使いたい場面 | Google カレンダー標準 | 調整さん | このアプリ（スキマ） |
|---|---|---|---|
| 相手が自分の空きから1枠えらぶ | **できる**（予約スケジュール） | できない | 将来の課題 |
| 複数人が候補に○×をつけて決める | **できない** | **できる** | **できる** |
| 自分のカレンダーの空きから候補を作る | 該当なし | できない | **できる** |
| 決定後に自動でカレンダー登録 | 自動 | できない | **できる** |
| Google Meet のリンク発行 | 自動 | できない | **できる** |
| 決定内容を LINE / メールへ渡す | 招待メールのみ | できない | **できる**（ワンタップ共有） |

いま感じている「毎回の設定が面倒」は、**候補日時を手で並べる作業**と、
**決まったあとにカレンダーと会議URLを別々に用意する作業**の2か所に集中しています。
このアプリは、その2か所だけを潰す設計にしました。

---

## 事実：Google カレンダーの「予約スケジュール」でできること

- **1対1の予約受付ページ**です。自分の空き時間を公開し、相手がそこから1枠を選ぶ形式。
  予約が入ると双方のカレンダーに自動登録されます。
- **無料の個人 Google アカウントでも使えます**が、**作れる予約ページは1つまで**。
  複数ページや決済、リマインドメールは Google Workspace の上位プラン、
  または個人向けの Google One Premium が必要です。
- 旧「予約枠（Appointment slots）」は廃止され、この「予約スケジュール」に置き換わりました。

### つまり何が足りないのか

予約スケジュールは「**空いている枠を先着で埋める**」道具です。
「**5人の都合を突き合わせて、いちばん多い日を選ぶ**」という調整さん的な使い方はできません。
複数人の合意形成をカバーしていない、というのが、いま作る根拠です。

> 事実と推測の区別：ここまでは Google の公式ヘルプに書かれている内容（事実）です。
> 「今後 Google が投票機能を足す可能性」については公表情報がなく、**不明**です。

---

## 事実：LINE への「自動送信」は、思ったより制約が重い

やり取りしているトークルームに、決定内容を自動で流したい——という要望が
いちばん引っかかるのがここです。

- 個人開発でよく使われていた **LINE Notify は 2025年3月31日にサービス終了**しました。
  代替として案内されているのは **Messaging API**（LINE 公式アカウントから送る仕組み）です。
- Messaging API で送るには、**LINE 公式アカウントの開設**が要ります。
  さらに送信先が**その公式アカウントを友だち登録している**必要があり、
  プランごとに**無料で送れる通数の上限**があります。
- 個人どうしの普通のトークルームに、外部アプリが割り込んで投稿することは**できません**。

### Messenger も同様

- Messenger Platform には「**24時間ルール**」があります。
  利用者からメッセージが来てから24時間以内であれば返信でき、
  それを過ぎると承認済みのメッセージタグや有料の Sponsored Message が必要になります。
- こちらも **Facebook ページ**と**アプリ審査**が前提です。

---

## だから、この設計にした（最適解の置きどころ）

「決まった瞬間、やり取りしているトークに URL が出る」という理想には、
**2つの実現ルート**があります。どちらか一方ではなく、両方を用意しました。

### ルートA：ワンタップ共有（既定・審査不要）

確定した瞬間に、そのまま貼れる文面を作ります。
スマホでは **Web Share API**（OSの共有シート）で、LINE・Messenger・メール・Slack など
**端末に入っているアプリへ直接渡せます**。PCでは LINE の共有リンクとメールリンクを用意。

- **利点**：設定ゼロ、審査ゼロ、今日から使える。個人のトークにも送れる。
- **欠点**：完全な自動ではなく、**送信ボタンを1回押す必要**があります。

### ルートB：登録した宛先へ push（任意・要設定）

LINE 公式アカウントを持っているなら、宛先ID を登録して自動送信できます。
Slack や Discord の Webhook URL も同じ枠組みで扱えます。

- **利点**：本当に自動で流れる。
- **欠点**：公式アカウントの開設と、相手の友だち登録が要る。無料通数の上限もある。

> **反対意見も書いておきます。**
> 「1タップの手間を消すために、公式アカウントを開設して友だち登録を集める」のは、
> 個人利用では**割に合わない可能性が高い**と考えています。
> 社内チーム利用（Slack / Discord の Webhook）であれば設定は数分で終わるので、
> ルートBが効くのはむしろそちらだと見ています。ここは**推測**です。

---

## つくらない選択肢（正直な比較）

自分で作らずに済ませるなら、以下が現実的な候補です。

| サービス | 向いている点 | 引っかかる点 |
|---|---|---|
| **調整さん** | 誰でも使える、説明不要 | カレンダー連携と会議URL発行がない |
| **TimeRex / Spir / Jicoo** | Google 連携と複数人調整に対応、日本語 | 人数や機能で有料になる |
| **Calendly** | 世界標準、機能が厚い | 1対1の予約受付が主。日本語圏の相手には説明が要る |
| **Cal.com** | オープンソースで自前運用できる | 機能が多く、設定と運用の負担が大きい |

**自作を選ぶ理由が立つのは、次の場合だけです。**

1. 「候補への○×投票」と「Google 連携」を**両方**、無料で、自分の使い方に合わせたい
2. 決定文面の書式や送り先を**自分の運用に合わせて変えたい**
3. 参加者に**アカウント登録をさせたくない**

逆に、上の3つに当てはまらないなら、**TimeRex などの既製品を使うほうが早い**と思います。
このリポジトリは「1と3が効いている」という前提で書かれています。

---

## 出典

- [Learn about appointment schedules in Google Calendar — Google Workspace Individual Help](https://support.google.com/google-workspace-individual/answer/11608416)
- [Create an appointment schedule — Google Calendar Help](https://support.google.com/calendar/answer/10729749)
- [Compare premium features for appointment schedules — Google Calendar Help](https://support.google.com/calendar/answer/16287038)
- [Learn about changes to Google Calendar appointment slots — Google Calendar Help](https://support.google.com/calendar/answer/190998)
- [Let others easily book time with you using the new pre-configured Google Calendar booking page — Google Workspace Updates](https://workspaceupdates.googleblog.com/2025/08/pre-configured-appointment-booking-calendar.html)
- [LINE Notify のサービス終了について — LINE Developers](https://developers.line.biz/ja/news/2025/04/01/line-notify/)
- [End of service for LINE Notify](https://notify-bot.line.me/closing-announce)
- [Messenger Platform and IG Messaging API policy — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy)
- [Send a message — Messenger Platform — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages)

> Google Calendar API の技術仕様（`conferenceData` による Meet リンク発行など）は、
> この作業環境から `developers.google.com` へ接続できなかったため、
> **公式ドキュメントの原文確認は未実施**です。実装は既知の仕様に基づいており、
> 実際の Google 認証情報での動作確認は各自の環境で行ってください。
