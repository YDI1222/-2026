#!/bin/bash
# 定期実行（launchd）を登録・確認・解除する。
#
#   ./install_launchd.sh status     # 登録状況を見るだけ（何も変更しない）
#   ./install_launchd.sh install    # 登録する（確認してから実行）
#   ./install_launchd.sh uninstall  # 解除する
#
# 過去に作った別名の定期実行（22時のrsyncなど）は、この方法では消しません。
# diagnose_mac.sh の結果を見て、二重実行にならないか確認してから install してください。

set -u
LABEL="com.yojo.obsidian-drive-sync"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$AIO_ROOT/logs"

case "${1:-status}" in
  status)
    if [ -f "$TARGET" ]; then echo "登録ファイル：あり（$TARGET）"; else echo "登録ファイル：なし"; fi
    launchctl list 2>/dev/null | grep "$LABEL" || echo "launchd上：未読み込み"
    ;;
  install)
    [ -f "$AIO_ROOT/config/local.env" ] || { echo "先に config/local.env を作成してください"; exit 1; }
    echo "まず試運転します（何も変更しません）…"
    /bin/bash "$SCRIPT_DIR/sync_to_drive.sh" || { echo "試運転で問題が出たため登録を中止しました"; exit 1; }
    printf '毎日 7:30 と 22:00 の自動コピーを登録します。よろしいですか？ [y/N] '
    read -r ans
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "中止しました"; exit 0; }
    mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
    sed -e "s|__SCRIPT__|$SCRIPT_DIR/sync_to_drive.sh|" -e "s|__LOGDIR__|$LOG_DIR|g" "$TEMPLATE" > "$TARGET"
    plutil -lint "$TARGET" || { echo "設定ファイルの形式エラー"; rm -f "$TARGET"; exit 1; }
    launchctl bootout "gui/$(id -u)" "$TARGET" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$TARGET" && echo "登録しました：$TARGET"
    echo "※ 初回に「フルディスクアクセス」や「Google Driveへのアクセス」の許可を求められたら許可してください。"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)" "$TARGET" 2>/dev/null
    rm -f "$TARGET" && echo "解除しました"
    ;;
  *)
    echo "使い方：$0 status|install|uninstall"; exit 1 ;;
esac
