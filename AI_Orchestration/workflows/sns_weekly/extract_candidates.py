#!/usr/bin/env python3
"""Obsidian の保管庫から「#発信候補」タグ付きノートを抜き出し、SNS原稿づくりの材料リストを作る。

使い方：
  python3 extract_candidates.py --vault "~/Documents/Second Brain"            # 一覧を表示
  python3 extract_candidates.py --vault ... --out ../../shared/inbox/x.json   # JSONに保存
  python3 extract_candidates.py --vault ... --mark-used x.json                # 本人承認後、使用済みにする

ノートを書き換えることはありません（読み取りのみ）。
- 過去に使ったノート（内容が同じもの）は除外する → 同じ話題の重複投稿を防ぐ
- 業務記録フォルダ（config/obsidian_sync_excludes.txt）は読まない
- 個人が特定されそうな記述（メール・電話番号・「患者」「クライアント」等）があれば要確認の印をつける
"""

import argparse
import fnmatch
import hashlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
AIO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, AIO_ROOT)
from lib.common import log_event, now_jst  # noqa: E402

DEFAULT_TAG = "発信候補"
EXCLUDES_FILE = os.path.join(AIO_ROOT, "config", "obsidian_sync_excludes.txt")
STATE_FILE = os.path.join(AIO_ROOT, "logs", "sns_used_notes.json")

PRIVACY_PATTERNS = [
    ("メールアドレス", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
    ("電話番号", re.compile(r"0\d{1,4}-\d{1,4}-\d{3,4}")),
    ("個人・顧客を示す語", re.compile(r"患者|利用者さん|クライアント|相談者|面談記録|カルテ")),
]


def load_excludes(path=EXCLUDES_FILE):
    pats = [".obsidian/*", ".trash/*"]
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    pats.append(line.rstrip("/") + ("/*" if line.endswith("/") else ""))
    return pats


def is_excluded(rel, patterns):
    for p in patterns:
        if fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(os.path.basename(rel), p):
            return True
        # 「業務記録/*」は 業務記録/a/b.md も除外する
        if p.endswith("/*") and rel.startswith(p[:-1]):
            return True
    return False


def split_frontmatter(text):
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            return text[4:end], text[end + 4:].lstrip("\n")
    return "", text


def has_tag(text, tag):
    fm, body = split_frontmatter(text)
    # 本文中のタグ：#発信候補 の直後がタグ文字で続かないこと（#発信候補メモ などは別タグ）
    if re.search(r"(^|[\s(（])#" + re.escape(tag) + r"(?![\w/\-])", body, re.M):
        return True
    # フロントマターの tags: [発信候補] / tags: 発信候補 / tags:\n  - 発信候補
    return tag in frontmatter_tags(fm)


def frontmatter_tags(fm):
    tags, in_block = set(), False
    for line in fm.splitlines():
        m = re.match(r"^tags:\s*(.*)$", line)
        if m:
            inline = m.group(1).strip().strip("[]")
            tags.update(t.strip().strip("'\"").lstrip("#") for t in re.split(r"[,\s]+", inline) if t.strip())
            in_block = not inline
        elif in_block and re.match(r"^\s*-\s*", line):
            tags.add(re.sub(r"^\s*-\s*", "", line).strip().strip("'\"").lstrip("#"))
        elif in_block and line.strip():
            in_block = False
    return tags


def normalize(text):
    _, body = split_frontmatter(text)
    body = re.sub(r"#[^\s#]+", "", body)  # タグの付け外しで別物扱いしない
    return re.sub(r"\s+", "", body)


def content_hash(text):
    return hashlib.sha1(normalize(text).encode("utf-8")).hexdigest()[:16]


def title_of(rel, body):
    m = re.search(r"(?m)^#\s+(.+)$", body)
    return m.group(1).strip() if m else os.path.splitext(os.path.basename(rel))[0]


def privacy_flags(text):
    return [name for name, pat in PRIVACY_PATTERNS if pat.search(text)]


def load_state(path=STATE_FILE):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"used": {}}


def save_state(state, path=STATE_FILE):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)  # 書き込み途中で止まってもファイルが壊れない


def extract(vault, tag=DEFAULT_TAG, since_days=None, state=None, excludes=None, snippet_len=400):
    vault = os.path.expanduser(vault)
    if not os.path.isdir(os.path.join(vault, ".obsidian")):
        raise FileNotFoundError("Obsidianの保管庫ではありません（.obsidian が無い）: " + vault)
    excludes = load_excludes() if excludes is None else excludes
    used = (state or {"used": {}})["used"]
    used_titles = {v.get("title") for v in used.values() if v.get("title")}
    cutoff = time.time() - since_days * 86400 if since_days else None

    found, skipped = [], {"used_before": 0, "duplicate_in_batch": 0, "too_old": 0}
    seen_hash, seen_title = set(), set()
    for dirpath, dirnames, filenames in os.walk(vault):
        dirnames[:] = sorted(d for d in dirnames if d not in (".obsidian", ".trash", ".git"))
        for name in sorted(filenames):
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, vault).replace(os.sep, "/")
            if is_excluded(rel, excludes):
                continue
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
            if not has_tag(text, tag):
                continue
            mtime = os.path.getmtime(path)
            if cutoff and mtime < cutoff:
                skipped["too_old"] += 1
                continue
            h = content_hash(text)
            _, body = split_frontmatter(text)
            title = title_of(rel, body)
            if h in used or title in used_titles:
                skipped["used_before"] += 1
                continue
            if h in seen_hash or title in seen_title:
                skipped["duplicate_in_batch"] += 1
                continue
            seen_hash.add(h)
            seen_title.add(title)
            snippet = re.sub(r"\s+", " ", body).strip()[:snippet_len]
            found.append({
                "note": rel,
                "title": title,
                "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(mtime)),
                "hash": h,
                "tags": sorted(set(re.findall(r"#([^\s#、。,]+)", body)) - {tag}),
                "privacy_review_needed": privacy_flags(text),
                "snippet": snippet,
            })
    found.sort(key=lambda x: x["modified"], reverse=True)
    return found, skipped


def main(argv=None):
    ap = argparse.ArgumentParser(description="#発信候補 ノートの抽出")
    ap.add_argument("--vault", default=os.environ.get("VAULT_PATH"), help="Obsidian保管庫のパス")
    ap.add_argument("--tag", default=DEFAULT_TAG)
    ap.add_argument("--since-days", type=int, default=None, help="この日数以内に更新したノートだけ")
    ap.add_argument("--out", help="結果を保存するJSONのパス")
    ap.add_argument("--mark-used", metavar="JSON", help="承認済みの候補JSONを渡すと、使用済みとして記録")
    ap.add_argument("--state", default=STATE_FILE)
    a = ap.parse_args(argv)

    state = load_state(a.state)
    if a.mark_used:
        with open(a.mark_used, encoding="utf-8") as f:
            data = json.load(f)
        today = now_jst().strftime("%Y-%m-%d")
        for c in data["candidates"]:
            state["used"][c["hash"]] = {"note": c["note"], "title": c["title"], "used_on": today}
        save_state(state, a.state)
        log_event("sns_weekly", "ok", "使用済みとして記録", count=len(data["candidates"]))
        print("使用済みに記録：%d 件" % len(data["candidates"]))
        return 0

    if not a.vault:
        ap.error("--vault か config/local.env の VAULT_PATH を指定してください")
    try:
        found, skipped = extract(a.vault, a.tag, a.since_days, state)
    except FileNotFoundError as e:
        log_event("sns_weekly", "error", str(e))
        print("[error]", e)
        return 2

    result = {
        "generated_at": now_jst().isoformat(timespec="seconds"),
        "tag": a.tag,
        "count": len(found),
        "skipped": skipped,
        "status": "確認待ち",
        "candidates": found,
    }
    level = "ok" if found else "warn"
    msg = "候補 %d 件（過去に使用済み %d／重複 %d／期間外 %d を除外）" % (
        len(found), skipped["used_before"], skipped["duplicate_in_batch"], skipped["too_old"])
    if len(found) < 7:
        msg += "。7本に足りないため、提案の種DBなど他の材料で補う必要があります"
    log_event("sns_weekly", level, msg)
    print("[%s] %s" % (level, msg))
    flagged = [c["note"] for c in found if c["privacy_review_needed"]]
    if flagged:
        print("要確認（個人が特定されうる記述）：", ", ".join(flagged))

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print("保存：", a.out)
    else:
        for c in found:
            print("- %s  %s  (%s)" % (c["modified"], c["title"], c["note"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
