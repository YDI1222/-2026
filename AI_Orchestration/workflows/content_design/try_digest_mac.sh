#!/bin/bash
# 【Macで試す用】Obsidian から「本人の言葉」を取り出して、デスクトップに結果を出すだけのスクリプト。
#
# 使い方（ターミナルで）：
#   1. 「bash 」と入力（最後に半角スペース）
#   2. このファイルをターミナルの画面にドラッグ＆ドロップして Enter
#   3. 聞かれたら、Obsidian の保管庫フォルダをドラッグ＆ドロップして Enter
#
# 安全について：
#   - Obsidian のノートは「読むだけ」。書き換え・削除・移動は一切しません。
#   - インターネットには何も送りません。Google Drive にも書き込みません。
#   - 作るのはデスクトップの結果ファイル2つ（insight_digest_試し_日付.md / .json）だけです。

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAYS="${1:-14}"

echo ""
echo "=== Obsidian の気づきを取り出す（お試し）==="
echo ""

# --- python3 が使えるか ---
if ! python3 --version >/dev/null 2>&1; then
  echo "【止まりました】python3 がまだ使えません。"
  echo "  画面に「コマンドライン・デベロッパ・ツールをインストールしますか？」と出たら「インストール」を押し、"
  echo "  完了（数分〜10分ほど）してから、もう一度このスクリプトを実行してください。"
  exit 1
fi

# --- 保管庫の場所を聞く ---
VAULT="${VAULT_PATH:-}"
if [ -z "$VAULT" ]; then
  echo "Obsidian の保管庫フォルダ（例：Second Brain）を、この画面にドラッグ＆ドロップして Enter を押してください。"
  printf '> '
  IFS= read -r VAULT
fi

# ドラッグ＆ドロップで付く「\」や前後の空白・引用符を取り除く
VAULT="$(printf '%s' "$VAULT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^'//" -e "s/'\$//" -e 's/^"//' -e 's/"$//' -e 's/\\\(.\)/\1/g')"
VAULT="${VAULT%/}"

if [ ! -d "$VAULT" ]; then
  echo ""
  echo "【止まりました】そのフォルダが見つかりません：$VAULT"
  echo "  フォルダそのもの（中のファイルではなく）をドラッグしてください。"
  exit 2
fi
if [ ! -d "$VAULT/.obsidian" ]; then
  echo ""
  echo "【止まりました】このフォルダは Obsidian の保管庫ではないようです：$VAULT"
  echo "  ヒント：ノートが入っているフォルダの「1つ上」が保管庫のことがあります。"
  echo "  Obsidian でノートを右クリック →「Finderで表示」で、ノートの場所が開きます（表示名はバージョンで少し違うことがあります）。"
  exit 3
fi

STAMP="$(date '+%Y%m%d_%H%M')"
OUT_MD="$HOME/Desktop/insight_digest_試し_$STAMP.md"
OUT_JSON="$HOME/Desktop/insight_digest_試し_$STAMP.json"

echo ""
echo "読み込み中…（直近 ${DAYS} 日のノート。ノートは読むだけで、変更しません）"
if ! python3 "$AIO_ROOT/workflows/content_design/insight_digest.py" \
     --vault "$VAULT" --days "$DAYS" --out "$OUT_MD" --json "$OUT_JSON"; then
  echo ""
  echo "【止まりました】読み込みでエラーが出ました。上に表示された文章を、そのまま Claude に貼り付けてください。"
  exit 4
fi

echo ""
echo "=== できました ==="
echo "結果：$OUT_MD"
echo ""
echo "確認してほしいこと（3つ）"
echo "  1) 並んでいる文章は「確かに自分の言葉だ」と思えるか"
echo "  2) 発信に使ってほしくない私的な内容が入っていないか"
echo "  3) 大事な気づきが漏れていないか（漏れていたら、そのノートの日付を覚えておく）"
echo ""
echo "少なすぎる時は、期間を広げて試せます： bash（このファイル） 30"
echo ""

# テキストエディットで開く（Mac のみ）
if command -v open >/dev/null 2>&1; then
  open -e "$OUT_MD" 2>/dev/null || open "$OUT_MD" 2>/dev/null || true
fi
