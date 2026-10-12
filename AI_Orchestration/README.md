# AI_Orchestration ― 養生デザインのAI協働基盤

ゆうだいさんのAI環境（Claude・ChatGPT・Gemini・Obsidian・Google Workspace）を、
**止まったら気づけて、壊さずに直せて、AI同士が引き継げる** 状態にするためのフォルダです。

## まず読むもの

| 文書 | 内容 |
|---|---|
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | いま何が動いていて、何を承認してほしいか |
| [docs/05_結果報告.md](docs/05_結果報告.md) | 今回やったこと・テスト結果・次にやること |
| [docs/01_現状調査レポート.md](docs/01_現状調査レポート.md) | 2026-10-12 時点で確認した事実 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 全体の構成・AIの役割分担・費用 |
| [docs/03_修復実装計画.md](docs/03_修復実装計画.md) | 直す順番とテスト方法 |
| [docs/06_Obsidianをコンテンツ設計に反映する.md](docs/06_Obsidianをコンテンツ設計に反映する.md) | 本人の言葉を原稿の芯にする仕組み |
| [AGENTS.md](AGENTS.md) | すべてのAIが守るルール |

## 中身

```
AI_Orchestration/
├── README.md / PROJECT_STATUS.md / ARCHITECTURE.md / AGENTS.md / CLAUDE.md
├── config/
│   ├── local.env.example          … Mac ごとの場所の設定（コピーして local.env を作る）
│   ├── obsidian_sync_excludes.txt … Drive に出さないフォルダ（業務記録など）
│   ├── router_rules.json          … 受付係の判定ルール（区分A〜H）
│   └── content_themes.json        … 気づきのテーマ分類
├── workflows/
│   ├── obsidian_sync/   … Mac診断・Driveへのコピー・定期実行の登録
│   ├── daily_briefing/  … 提案の種DBの健康診断・重複チェック・Scout指示文
│   ├── content_design/  … Obsidian の本人の言葉を取り出す（Insight Digest）・原稿の指示文
│   ├── sns_weekly/      … #発信候補の抽出・週次原稿の点検（本人の言葉の照合つき）
│   ├── project_router/  … 受付係（区分判定・引き継ぎ票）
│   └── healthcheck/     … クラウドの点検ルーチン用の指示文
├── shared/  … AI間の受け渡し（inbox→working→review→completed）※中身はGit対象外
├── lib/     … 共通部品（ログ・ロック・再試行・xlsx読み取り）
├── logs/    … 実行記録 ※Git対象外
├── tests/   … テスト（49件）
└── docs/
```

## まず試すだけなら

**[docs/07_Macで試す手順_初心者向け.md](docs/07_Macで試す手順_初心者向け.md)**（約15分・ノートは読むだけ・何も送らない）

## Mac で使い始める（3ステップ）

ターミナルを開いて、上から順に貼り付けます。どれも **何も削除しません**。

```bash
# 1) 取得（初回のみ）。このリポジトリは公開設定なので、ログインなしで取得できます
#    （いちばん簡単なのは docs/07 の「ZIPをダウンロード」する方法です）
cd ~/Documents && git clone -b claude/ai-orchestration-handoff-opnmu8 https://github.com/YDI1222/-2026.git yojo-ai && cd yojo-ai/AI_Orchestration

# 2) 診断（読み取りのみ。結果は logs/ に保存）
bash workflows/obsidian_sync/diagnose_mac.sh

# 3) 設定ファイルを作り、試運転（何もコピーしない）
cp config/local.env.example config/local.env
open -e config/local.env        # 保管庫とDriveの場所を確認・修正して保存
bash workflows/obsidian_sync/sync_to_drive.sh
```

試運転で問題がなければ、`bash workflows/obsidian_sync/install_launchd.sh install` で毎日 7:30・22:00 の自動コピーを登録できます（確認の質問が出ます）。

Mac 上で Claude Code を起動して「AI_Orchestration の診断を実行して結果を説明して」と頼むこともできます。

## テスト

```bash
cd AI_Orchestration && python3 -m unittest discover -s tests -v
```
追加インストール不要。macOS 標準の python3・bash・rsync で動きます
（python3 を初めて使う時は「コマンドライン・デベロッパ・ツール」のインストール確認が出ることがあります。macOS 標準の手順です）。
