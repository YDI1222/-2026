"""全ワークフロー共通の小さな部品（標準ライブラリのみ）。

- ログ：logs/ に1行1件のJSON（JSONL）で残す。秘密情報らしき文字列は伏せ字にする。
- ロック：同じ処理が二重に走らないようにする（重複登録・ファイル破損の防止）。
- 再試行：回数に上限をつける（無限ループ防止）。

macOS標準の python3（3.9）でも動くよう、新しい構文は使わない。
"""

import datetime as _dt
import json
import os
import re
import time
from contextlib import contextmanager

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.environ.get("AIO_LOG_DIR", os.path.join(ROOT, "logs"))

JST = _dt.timezone(_dt.timedelta(hours=9), "JST")

# APIキー・トークン・パスワードらしきものはログに残さない
_SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\bya29\.[0-9A-Za-z_-]{20,}\b"),
]


def now_jst():
    return _dt.datetime.now(JST)


def redact(text):
    if not isinstance(text, str):
        return text
    for pat in _SECRET_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


def _redact_obj(obj):
    if isinstance(obj, dict):
        return {k: _redact_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_obj(v) for v in obj]
    return redact(obj)


def log_event(workflow, status, message, **detail):
    """logs/<workflow>.jsonl に1行追記し、書いた内容を返す。

    status は ok / warn / error / skip のいずれかを想定。
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    entry = {
        "time": now_jst().isoformat(timespec="seconds"),
        "workflow": workflow,
        "status": status,
        "message": redact(message),
    }
    if detail:
        entry["detail"] = _redact_obj(detail)
    path = os.path.join(LOG_DIR, workflow + ".jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


class LockBusy(Exception):
    pass


@contextmanager
def single_run_lock(name, stale_after_sec=6 * 3600):
    """同名の処理が実行中なら LockBusy を投げる。古すぎるロックは残骸とみなして外す。"""
    os.makedirs(LOG_DIR, exist_ok=True)
    path = os.path.join(LOG_DIR, "." + name + ".lock")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) > stale_after_sec:
        os.remove(path)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise LockBusy(name)
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield path
    finally:
        if os.path.exists(path):
            os.remove(path)


def retry(func, attempts=3, wait_sec=2.0, retry_on=(OSError,)):
    """失敗したら最大 attempts 回まで試す。待ち時間は 2s, 4s, 8s... と伸ばす。"""
    if attempts < 1 or attempts > 5:
        raise ValueError("attempts は1〜5回に制限しています")
    last = None
    for i in range(attempts):
        try:
            return func()
        except retry_on as e:  # noqa: PERF203
            last = e
            if i < attempts - 1:
                time.sleep(wait_sec * (2 ** i))
    raise last


def keyword_hits(text, keywords):
    """text に含まれるキーワードを返す。英数字だけのキーワードは単語として一致した時だけ数える
    （"AI" が "MAIL" に、"X" が "Excel" に反応しないように）。"""
    hits = []
    for kw in keywords:
        if re.fullmatch(r"[A-Za-z0-9 .\-]+", kw):
            if re.search(r"(?<![A-Za-z])" + re.escape(kw) + r"(?![A-Za-z])", text, re.I):
                hits.append(kw)
        elif kw in text:
            hits.append(kw)
    return hits
