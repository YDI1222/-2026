#!/bin/bash
# Obsidian の正規保管庫 → Google Drive（AI参照用コピー）への一方向コピー。
#
# 使い方：
#   ./sync_to_drive.sh            # 試運転（何がコピーされるか表示するだけ。何も変更しない）
#   ./sync_to_drive.sh --apply    # 実際にコピーする（launchd からはこちらで呼ばれる）
#
# 安全装置：
#   - 方向は「保管庫 → Drive」だけ。Drive から保管庫へは絶対に書き込まない。
#   - 保管庫に .obsidian が無い、Drive が起動していない、などの時は何もせず止まる。
#   - 削除の反映は初期値オフ。オンでも消す前に退避する。
#   - 二重起動しない（ロック）。再試行は最大2回まで。
#   - 結果は logs/obsidian_sync.jsonl に残し、Drive側に _SYNC_STATUS.md を書く
#     （クラウドのClaudeがDriveから鮮度を確認できるようにするため）。
#
# macOS 標準の bash 3.2 / openrsync でも動くように、使う機能を絞っています。

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="${AIO_CONFIG:-$AIO_ROOT/config/local.env}"
EXCLUDES="$AIO_ROOT/config/obsidian_sync_excludes.txt"
LOG_DIR="${AIO_LOG_DIR:-$AIO_ROOT/logs}"
LOG_JSONL="$LOG_DIR/obsidian_sync.jsonl"
LOG_TEXT="$LOG_DIR/obsidian_sync.log"
LOCK_DIR="$LOG_DIR/.obsidian_sync.lock"
STATUS_NAME="_SYNC_STATUS.md"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

mkdir -p "$LOG_DIR"

json_escape() {
  # ダブルクォート・バックスラッシュ・改行だけを処理（ログ用途で十分）
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '
}

log() {
  # log <ok|warn|error|skip> <メッセージ>
  local ts
  ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '{"time":"%s","workflow":"obsidian_sync","host":"%s","status":"%s","apply":%s,"message":"%s"}\n' \
    "$ts" "$(json_escape "$HOST")" "$1" "$APPLY" "$(json_escape "$2")" >> "$LOG_JSONL"
  echo "[$1] $2"
}

HOST="$( (scutil --get ComputerName 2>/dev/null) || hostname)"

if [ ! -f "$CONFIG" ]; then
  log error "設定ファイルがありません：$CONFIG（config/local.env.example をコピーして作成してください）"
  exit 2
fi
# shellcheck disable=SC1090
. "$CONFIG"

VAULT_PATH="${VAULT_PATH:-}"
DRIVE_DEST="${DRIVE_DEST:-}"
PRIMARY_HOST="${PRIMARY_HOST:-}"
FALLBACK_AFTER_HOURS="${FALLBACK_AFTER_HOURS:-26}"
OPEN_OBSIDIAN_BEFORE_SYNC="${OPEN_OBSIDIAN_BEFORE_SYNC:-0}"
WAIT_FOR_OBSIDIAN_SEC="${WAIT_FOR_OBSIDIAN_SEC:-180}"
MIRROR_DELETE="${MIRROR_DELETE:-0}"
INSIGHT_DIGEST="${INSIGHT_DIGEST:-1}"
INSIGHT_DAYS="${INSIGHT_DAYS:-14}"
INSIGHT_SCOPE="${INSIGHT_SCOPE:-all}"

# ---------- 安全確認 ----------
VAULT_PATH="${VAULT_PATH%/}"
DRIVE_DEST="${DRIVE_DEST%/}"

if [ -z "$VAULT_PATH" ] || [ ! -d "$VAULT_PATH/.obsidian" ]; then
  log error "正規保管庫が見つかりません（.obsidian フォルダが無い）：$VAULT_PATH"
  exit 3
fi
if [ -z "$DRIVE_DEST" ] || [ ! -d "$(dirname "$DRIVE_DEST")" ]; then
  log error "Google Drive が起動していないか、場所が違います：$(dirname "$DRIVE_DEST")"
  exit 4
fi
if [ ! -d "$DRIVE_DEST" ]; then
  log error "コピー先フォルダがありません（自動では作りません）：$DRIVE_DEST"
  exit 4
fi
case "$DRIVE_DEST/" in
  "$VAULT_PATH"/*) log error "コピー先が保管庫の中にあります。設定を見直してください"; exit 5 ;;
esac
case "$VAULT_PATH/" in
  "$DRIVE_DEST"/*) log error "保管庫がコピー先の中にあります。設定を見直してください"; exit 5 ;;
esac

# ---------- どのMacが担当するか ----------
status_age_hours() {
  # Drive側の _SYNC_STATUS.md に書いた epoch から経過時間（時間）を返す。無ければ 9999。
  local f="$DRIVE_DEST/$STATUS_NAME" epoch now
  if [ -f "$f" ]; then
    epoch="$(sed -n 's/^last_success_epoch: *\([0-9][0-9]*\).*/\1/p' "$f" | head -n 1)"
    if [ -n "$epoch" ]; then
      now="$(date +%s)"
      echo $(( (now - epoch) / 3600 ))
      return
    fi
  fi
  echo 9999
}

if [ -n "$PRIMARY_HOST" ] && [ "$HOST" != "$PRIMARY_HOST" ]; then
  AGE="$(status_age_hours)"
  if [ "$AGE" -lt "$FALLBACK_AFTER_HOURS" ]; then
    log skip "主担当（$PRIMARY_HOST）が${AGE}時間前にコピー済みのため、このMacではスキップ"
    exit 0
  fi
  log warn "主担当の最終コピーから${AGE}時間経過。このMac（$HOST）が代わりにコピーします"
fi

# ---------- 二重起動防止 ----------
if [ -d "$LOCK_DIR" ]; then
  # 6時間より古いロックは前回の異常終了の残骸とみなす
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null
  fi
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log skip "前回のコピーがまだ実行中のためスキップ"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

# ---------- iPhoneの更新を取り込む ----------
if [ "$APPLY" = 1 ] && [ "$OPEN_OBSIDIAN_BEFORE_SYNC" = 1 ] && command -v open >/dev/null 2>&1; then
  if ! pgrep -x Obsidian >/dev/null 2>&1; then
    open -g -a Obsidian >/dev/null 2>&1 && log ok "Obsidianを裏で起動し、${WAIT_FOR_OBSIDIAN_SEC}秒待ちます（Obsidian Syncの取り込み待ち）"
    sleep "$WAIT_FOR_OBSIDIAN_SEC"
  fi
fi

# ---------- コピー ----------
# 空白を含むパスでも壊れないよう、引数は配列で組み立てる（bash 3.2 でも可）
RSYNC_ARGS=(-r -t -v "--exclude-from=$EXCLUDES" "--exclude=$STATUS_NAME" "--exclude=_sync_backup/" "--exclude=_AI_digest/")
if [ "$MIRROR_DELETE" = 1 ]; then
  BACKUP_DIR="_sync_backup/$(date '+%Y%m%d_%H%M%S')"
  RSYNC_ARGS+=(--delete --backup "--backup-dir=$BACKUP_DIR")
fi
[ "$APPLY" = 1 ] || RSYNC_ARGS+=(-n)

# ログが大きくなりすぎないよう 1MB を超えたら1世代だけ残す
if [ -f "$LOG_TEXT" ] && [ "$(wc -c < "$LOG_TEXT")" -gt 1048576 ]; then
  mv "$LOG_TEXT" "$LOG_TEXT.1"
fi

ATTEMPT=1
MAX_ATTEMPTS=3
RC=1
while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
  {
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') host=$HOST apply=$APPLY attempt=$ATTEMPT"
  } >> "$LOG_TEXT"
  OUT="$(rsync "${RSYNC_ARGS[@]}" "$VAULT_PATH/" "$DRIVE_DEST/" 2>&1)"
  RC=$?
  printf '%s\n' "$OUT" >> "$LOG_TEXT"
  [ "$RC" = 0 ] && break
  if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
    log warn "rsync が失敗（終了コード $RC）。$((ATTEMPT * 30))秒後に再試行します"
    sleep $((ATTEMPT * 30))
  fi
  ATTEMPT=$((ATTEMPT + 1))
done

if [ "$RC" != 0 ]; then
  LAST_ERR="$(printf '%s\n' "$OUT" | grep -i -E 'error|denied|not permitted|no such' | tail -n 3)"
  HINT=""
  case "$LAST_ERR" in
    *"not permitted"*) HINT="（macOSのプライバシー設定でフルディスクアクセスが必要な可能性）" ;;
  esac
  log error "コピー失敗（終了コード $RC）$HINT：$LAST_ERR"
  exit 6
fi

CHANGED="$(printf '%s\n' "$OUT" | grep -c -E '\.md$')"

if [ "$APPLY" != 1 ]; then
  log ok "試運転完了：コピー対象の .md は ${CHANGED} 件（何も変更していません。詳細は logs/obsidian_sync.log）"
  exit 0
fi

# ---------- 検証：最近更新した .md が Drive 側と一致するか ----------
MISMATCH=0
CHECKED=0
RECENT_LIST="$(find "$VAULT_PATH" -type f -name '*.md' -not -path '*/.obsidian/*' -not -path '*/.trash/*' -mtime -3 2>/dev/null | head -n 50)"
OLD_IFS="$IFS"
IFS='
'
for f in $RECENT_LIST; do
  rel="${f#"$VAULT_PATH"/}"
  if [ -f "$DRIVE_DEST/$rel" ]; then
    CHECKED=$((CHECKED + 1))
    cmp -s "$f" "$DRIVE_DEST/$rel" || MISMATCH=$((MISMATCH + 1))
  fi
done
IFS="$OLD_IFS"

TOTAL_MD="$(find "$VAULT_PATH" -type f -name '*.md' -not -path '*/.obsidian/*' -not -path '*/.trash/*' 2>/dev/null | wc -l | tr -d ' ')"
NEWEST="$(find "$VAULT_PATH" -type f -name '*.md' -not -path '*/.obsidian/*' -not -path '*/.trash/*' -mtime -2 2>/dev/null | sed "s|^$VAULT_PATH/||" | sort | tail -n 5 | tr '\n' ',' )"

cat > "$DRIVE_DEST/$STATUS_NAME" <<EOF
# Obsidian → Google Drive コピー状況

このファイルは自動で書き換わります。手で編集しないでください。

last_success: $(date '+%Y-%m-%d %H:%M:%S %z')
last_success_epoch: $(date +%s)
host: $HOST
markdown_files_in_vault: $TOTAL_MD
copied_md_this_run: $CHANGED
verified_recent_files: $CHECKED
verify_mismatch: $MISMATCH
recent_notes: $NEWEST
EOF

# ---------- Insight Digest（Obsidian の本人の言葉を、コンテンツ設計の材料にする） ----------
if [ "$INSIGHT_DIGEST" = 1 ]; then
  if command -v python3 >/dev/null 2>&1; then
    DIGEST_DIR="$DRIVE_DEST/_AI_digest"
    mkdir -p "$DIGEST_DIR"
    if DOUT="$(AIO_LOG_DIR="$LOG_DIR" python3 "$AIO_ROOT/workflows/content_design/insight_digest.py" \
        --vault "$VAULT_PATH" --days "$INSIGHT_DAYS" --scope "$INSIGHT_SCOPE" \
        --out "$DIGEST_DIR/insight_digest_latest.md" --json "$DIGEST_DIR/insight_digest_latest.json" 2>&1)"; then
      log ok "Insight Digest を更新：$(printf '%s' "$DOUT" | head -n 1)"
    else
      log warn "Insight Digest の作成に失敗（コピー自体は成功）：$(printf '%s' "$DOUT" | tail -n 2)"
    fi
  else
    log warn "python3 が無いため Insight Digest を作れません（コピー自体は成功）"
  fi
fi

if [ "$MISMATCH" -gt 0 ]; then
  log warn "コピー後の照合で ${MISMATCH}/${CHECKED} 件が一致しません（Drive側の反映待ちの可能性）"
  exit 7
fi
log ok "コピー完了：.md ${CHANGED} 件を更新、直近ファイル ${CHECKED} 件を照合して一致"
exit 0
