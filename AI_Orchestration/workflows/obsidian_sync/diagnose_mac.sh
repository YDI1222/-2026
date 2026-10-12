#!/bin/bash
# Mac の現状を調べるだけのスクリプト（読み取り専用。何も変更・削除しません）。
#
#   ./diagnose_mac.sh
#
# 結果は画面に表示し、logs/diagnose_<Mac名>_<日時>.md にも保存します。
# ノートの「本文」は読みません。ファイル名・更新日時・件数・タグの有無だけを集計します。
# Mac mini と MacBook Air の両方で1回ずつ実行してください。

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="${AIO_LOG_DIR:-$AIO_ROOT/logs}"
mkdir -p "$LOG_DIR"
HOST="$( (scutil --get ComputerName 2>/dev/null) || hostname)"
STAMP="$(date '+%Y%m%d_%H%M')"
OUT="$LOG_DIR/diagnose_$(printf '%s' "$HOST" | tr ' /' '__')_$STAMP.md"

# 秘密情報らしき行を伏せる
redact() { sed -E 's/((api[_-]?key|token|secret|password)[^=:]*[=:]).*/\1 [REDACTED]/I'; }

section() { printf '\n## %s\n\n' "$1"; }

{
echo "# Mac 診断レポート（$HOST）"
echo
echo "- 実行日時：$(date '+%Y-%m-%d %H:%M:%S %z')"
echo "- macOS：$(sw_vers -productVersion 2>/dev/null || uname -sr)"
echo "- rsync：$(rsync --version 2>&1 | head -n 1)"
echo "- python3：$( (python3 --version) 2>&1 | head -n 1)"

section "1. Obsidian が把握している保管庫"
OBS_JSON="$HOME/Library/Application Support/obsidian/obsidian.json"
if [ -f "$OBS_JSON" ]; then
  grep -o '"path":"[^"]*"' "$OBS_JSON" | sed 's/"path":"//; s/"$//' | while IFS= read -r p; do
    if [ -d "$p" ]; then
      n="$(find "$p" -type f -name '*.md' -not -path '*/.obsidian/*' -not -path '*/.trash/*' 2>/dev/null | wc -l | tr -d ' ')"
      last="$(find "$p" -type f -name '*.md' -not -path '*/.obsidian/*' -mtime -30 2>/dev/null | wc -l | tr -d ' ')"
      tag="$(grep -rl --include='*.md' '#発信候補' "$p" 2>/dev/null | wc -l | tr -d ' ')"
      echo "- \`$p\`：ノート ${n} 件／直近30日に更新 ${last} 件／#発信候補 ${tag} 件"
    else
      echo "- \`$p\`：**フォルダが存在しません**（過去に開いた保管庫の記録だけ残っている）"
    fi
  done
else
  echo "Obsidian の設定ファイルが見つかりません：$OBS_JSON"
fi

section "2. ほかに見つかった保管庫（.obsidian フォルダの場所）"
for base in "$HOME/Documents" "$HOME/Desktop" "$HOME/Library/Mobile Documents" "$HOME/Library/CloudStorage" "$HOME"; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 5 -type d -name .obsidian -not -path '*/Library/Caches/*' 2>/dev/null
done | sort -u | sed 's|/\.obsidian$||' | while IFS= read -r v; do echo "- \`$v\`"; done

section "3. 各保管庫で最近更新されたノート（新しい順に5件）"
for base in "$HOME/Documents" "$HOME/Desktop" "$HOME/Library/Mobile Documents" "$HOME"; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 5 -type d -name .obsidian -not -path '*/Library/*' 2>/dev/null
done | sort -u | sed 's|/\.obsidian$||' | while IFS= read -r v; do
  echo "### $v"
  find "$v" -type f -name '*.md' -not -path '*/.obsidian/*' -not -path '*/.trash/*' -exec stat -f '%Sm|%N' -t '%Y-%m-%d %H:%M' {} + 2>/dev/null \
    | sort -r | head -n 5 | sed "s|$v/||" | while IFS='|' read -r t n; do echo "- $t　$n"; done
done

section "4. Google Drive for desktop"
if [ -d "$HOME/Library/CloudStorage" ]; then
  ls -1 "$HOME/Library/CloudStorage" 2>/dev/null | sed 's/^/- /'
  for d in "$HOME/Library/CloudStorage"/GoogleDrive-*; do
    [ -d "$d" ] || continue
    echo
    echo "Obsidian関連フォルダ（$d 内）："
    find "$d" -maxdepth 4 -type d \( -name 'Second Brain*' -o -name 'SecondBrain*' -o -name 'Obsidian*' -o -name 'ChatGPT' \) 2>/dev/null \
      | while IFS= read -r f; do
          n="$(find "$f" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
          echo "- \`${f#"$d"/}\`（直下の .md ${n} 件）"
        done
  done
else
  echo "Google Drive for desktop のフォルダが見つかりません"
fi

section "5. 定期実行（launchd）"
ls -1 "$HOME/Library/LaunchAgents" 2>/dev/null | sed 's/^/- /'
echo
echo "rsync・Obsidian・Drive に関係しそうな設定："
for f in "$HOME/Library/LaunchAgents"/*.plist; do
  [ -f "$f" ] || continue
  if grep -q -i -E 'rsync|obsidian|drive|second|brain|sns|yojo' "$f" 2>/dev/null; then
    echo
    echo "### $(basename "$f")"
    echo '```'
    plutil -p "$f" 2>/dev/null | redact
    echo '```'
    for key in StandardOutPath StandardErrorPath; do
      lf="$(plutil -extract "$key" raw "$f" 2>/dev/null)"
      if [ -n "$lf" ] && [ -f "$lf" ]; then
        echo "$key の最後の10行（$lf）："
        echo '```'
        tail -n 10 "$lf" | redact
        echo '```'
      fi
    done
  fi
done
echo
echo "読み込み中のジョブ："
echo '```'
launchctl list 2>/dev/null | grep -i -E 'obsidian|rsync|drive|yojo|sync' || echo "（該当なし）"
echo '```'

section "6. cron"
echo '```'
(crontab -l 2>/dev/null | redact) || true
echo '```'

section "7. ショートカット（Shortcuts）"
if command -v shortcuts >/dev/null 2>&1; then
  shortcuts list 2>/dev/null | grep -i -E 'obsidian|rsync|drive|同期|コピー|sync' | sed 's/^/- /' || echo "（該当なし）"
else
  echo "shortcuts コマンドなし"
fi

section "8. スリープ・電源"
echo '```'
pmset -g 2>/dev/null | grep -E 'sleep|autorestart|womp|powernap' || true
pmset -g sched 2>/dev/null || true
echo '```'

section "9. 手で確認が必要なこと"
echo "- システム設定 > プライバシーとセキュリティ > フルディスクアクセス に bash / rsync / ターミナル が入っているか"
echo "- Obsidian の 設定 > Sync で、このMacが「Second Brain」の正しいリモート保管庫に接続しているか"
} 2>&1 | tee "$OUT"

echo
echo "保存しました：$OUT"
