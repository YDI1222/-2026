#!/usr/bin/env python3
"""Obsidian のノートから「本人にしか書けない言葉」を取り出し、コンテンツ設計の材料（Insight Digest）にする。

なぜ必要か：
  SNS原稿や提案書をAIに任せると、一般論や外部情報だけで「整った文章」ができてしまう。
  オリジナリティの源泉は、ゆうだいさんが Obsidian に書いた問い・気づき・体験。
  そこで、ノートを「1つの考え＝1ブロック」に分け、ID（INS-日付-番号）と原文のまま渡す。
  原稿側はこのIDと原文の引用を必ず示す → 後から「本当に本人の言葉か」を機械で確かめられる。

使い方：
  python3 insight_digest.py --vault "~/Documents/Second Brain" --days 14 --out digest.md
  python3 insight_digest.py --vault ... --days 14 --json digest.json --seed-xlsx 提案の種DB.xlsx
  python3 insight_digest.py --mark-used INS-20261010-2 INS-20261012-1   # 使った気づきを記録

ノートは読むだけで、書き換えません。業務記録フォルダ（config/obsidian_sync_excludes.txt）は読みません。
個人が特定されうる記述を含むブロックは、本文を出さず「要確認」として場所だけ示します。
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AIO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, AIO_ROOT)
from lib.common import keyword_hits, log_event, now_jst  # noqa: E402
from workflows.sns_weekly.extract_candidates import (  # noqa: E402
    DEFAULT_TAG, frontmatter_tags, has_tag, is_excluded, load_excludes, privacy_flags, split_frontmatter)

THEMES_PATH = os.path.join(AIO_ROOT, "config", "content_themes.json")
STATE_FILE = os.path.join(AIO_ROOT, "logs", "insight_used.json")

# ---- 「本人の声」の手がかり（一般論・外部情報との区別に使う） ----
QUESTION = re.compile(r"[？?]\s*$|だろうか|ではないか|のではないか|べきなのか|なのか[。？?]?$", re.M)
REFLECTION = re.compile(r"と思(う|い|っ)|と考え|気づ|感じ|実感|腑に落ち|モヤモヤ|違和感|大切なのは|重要なのは|本質|私は|自分は|僕は|私たち")
EXPERIENCE = re.compile(r"(今日|昨日|先日|先週|今回|この前|研修で|講演で|面談で|現場で|授業で|打ち合わせ|会議で).{0,40}(した|でした|ました|だった|話し|聞い|見)")
EXTERNAL = re.compile(r"https?://|によると|が発表|を公表|と報じ|ニュース|記事では|調査では|出典")
SEPARATOR = re.compile(r"^\s*(-{2,}|\*{3,}|_{3,})\s*$")
HEADING = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$")
DATE_IN_NAME = re.compile(r"(20\d{2})-(\d{2})-(\d{2})")

MIN_CHARS, MAX_CHARS = 40, 1200


def load_themes(path=THEMES_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["themes"]


def note_date(rel, mtime):
    m = DATE_IN_NAME.search(os.path.basename(rel))
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return dt.date.fromtimestamp(mtime)


def split_blocks(body):
    """見出し・区切り線（--）・2行以上の空行で、1つの考えごとに分ける。"""
    blocks, cur, title = [], [], None
    blank_run = 0

    def flush():
        text = "\n".join(cur).strip()
        if text:
            blocks.append((title, text))
        cur.clear()

    for line in body.splitlines():
        h = HEADING.match(line)
        if SEPARATOR.match(line):
            flush()
            continue
        if h:
            flush()
            title = h.group(1)
            continue
        if not line.strip():
            blank_run += 1
            if blank_run >= 2:
                flush()
            else:
                cur.append("")
            continue
        blank_run = 0
        cur.append(line)
    flush()
    return blocks


LABEL = re.compile(r"^\s*(問い|気づき|体験|主張)\s*[：:]", re.M)


def classify(text):
    """ブロックの種類と「本人の声らしさ」の点数を返す。点数が高いほど、AIだけでは書けない内容。

    ノートに「問い：」「気づき：」「体験：」と書いておくと、その種類として確実に拾う（任意の書き方）。
    """
    label = LABEL.search(text)
    if label:
        kind = "気づき" if label.group(1) == "主張" else label.group(1)
        return kind, 10
    q = len(QUESTION.findall(text))
    r = len(REFLECTION.findall(text))
    e = len(EXPERIENCE.findall(text))
    x = len(EXTERNAL.findall(text))
    score = 2 * q + 2 * r + 3 * e - 2 * x
    if e:
        kind = "体験"
    elif q and q >= r:
        kind = "問い"
    elif r:
        kind = "気づき"
    elif x:
        kind = "外部情報のメモ"
    else:
        kind = "メモ"
    return kind, score


def clean_text(text):
    text = re.sub(r"(?m)^\s*#[^\s#]+(\s+#[^\s#]+)*\s*$", "", text)  # タグだけの行
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def block_hash(text):
    return hashlib.sha1(re.sub(r"\s+", "", text).encode("utf-8")).hexdigest()[:12]


def collect(vault, days=14, today=None, themes=None, excludes=None, used=None, tag=DEFAULT_TAG, scope="all"):
    """scope="marked" のときは、#発信候補 または「問い：」等の印が付いたブロックだけを使う。"""
    vault = os.path.expanduser(vault)
    if not os.path.isdir(os.path.join(vault, ".obsidian")):
        raise FileNotFoundError("Obsidianの保管庫ではありません（.obsidian が無い）: " + vault)
    themes = themes if themes is not None else load_themes()
    excludes = load_excludes() if excludes is None else excludes
    used = used or {}
    today = today or now_jst().date()
    since = today - dt.timedelta(days=days) if days else None

    insights, withheld, stats = [], [], {"notes": 0, "blocks": 0, "too_short": 0, "used_before": 0, "not_own_voice": 0}
    notes = []
    for dirpath, dirnames, filenames in os.walk(vault):
        dirnames[:] = sorted(d for d in dirnames if d not in (".obsidian", ".trash", ".git"))
        for name in sorted(filenames):
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, vault).replace(os.sep, "/")
            if is_excluded(rel, excludes):
                continue
            d = note_date(rel, os.path.getmtime(path))
            if since and not (since <= d <= today):
                continue
            notes.append((d, rel, path))

    for d, rel, path in sorted(notes):
        with open(path, encoding="utf-8", errors="replace") as f:
            raw = f.read()
        stats["notes"] += 1
        fm, body = split_frontmatter(raw)
        note_tagged = tag in frontmatter_tags(fm)
        idx = 0
        for title, text in split_blocks(body):
            stats["blocks"] += 1
            tagged = note_tagged or has_tag(text, tag)
            text = clean_text(text)
            if len(re.sub(r"\s", "", text)) < MIN_CHARS:
                stats["too_short"] += 1
                continue
            idx += 1
            ins_id = "INS-%s-%d" % (d.strftime("%Y%m%d"), idx)
            h = block_hash(text)
            if h in used:
                stats["used_before"] += 1
                continue
            flags = privacy_flags(text)
            if flags:
                withheld.append({"id": ins_id, "date": str(d), "note": rel, "reason": flags})
                continue
            kind, score = classify(text)
            if scope == "marked" and not (tagged or LABEL.search(text)):
                stats["not_marked"] = stats.get("not_marked", 0) + 1
                continue
            if tagged:
                score += 5  # 本人が「発信したい」と選んだもの
            elif score <= 0:
                # ニュースの書き写し・買い物メモなど、本人の声の手がかりが無いものは材料にしない
                stats["not_own_voice"] += 1
                continue
            matched = {name: keyword_hits(text, kws) for name, kws in themes.items()}
            matched = {k: v for k, v in matched.items() if v}
            insights.append({
                "id": ins_id,
                "date": str(d),
                "note": rel,
                "heading": title,
                "kind": kind,
                "score": score,
                "tagged": tagged,
                "themes": sorted(matched, key=lambda k: -len(matched[k])),
                "keywords": sorted({w for v in matched.values() for w in v}),
                "hash": h,
                "text": text,  # 照合のため全文を保持（Markdown表示の時だけ短くする）
            })
    # 点数の高い順。同点なら新しいノートを先に
    insights.sort(key=lambda x: (-x["score"], -dt.date.fromisoformat(x["date"]).toordinal()))
    return insights, withheld, stats


SEED_CORE_COLS = ("テーマ", "SEED｜提案の種", "QUESTION｜育てる問い", "WHY｜なぜ重要か", "企業課題との接点")
MATCH_THRESHOLD = 0.15  # これ未満の一致は「機械では判断できない」とみなし、表示しない
_STOP_BIGRAMS = set("こと もの ため よう これ それ など また ので から まで する した して いる ある ない".split())


def _bigrams(text):
    """日本語を単語に分けずに比べるため、2文字ずつの組み合わせ（例：職場・場環・環境）に分解する。"""
    import collections
    text = re.sub(r"https?://\S+", "", text)
    segs = re.split(r"[\s、。・「」『』（）()×／/…:：,.!?！？\-]+", text)
    grams = collections.Counter()
    for seg in segs:
        for i in range(len(seg) - 1):
            bg = seg[i:i + 2]
            if bg in _STOP_BIGRAMS or re.fullmatch(r"[ぁ-ん]{2}", bg):
                continue  # ひらがなだけの組み合わせは意味の手がかりが弱い
            grams[bg] += 1
    return grams


def attach_seeds(insights, seed_xlsx, per_insight=2, threshold=MATCH_THRESHOLD):
    """提案の種DB（外部の根拠）から、内容の近いSeedを「候補」として添える。

    方法：2文字の組み合わせの重なり（多くのSeedに出る組み合わせほど軽く数える）で近さを測る。
    限界：言い換え（例「自走」と「行動変容」）は拾えない。近さが基準未満なら何も添えず、
    根拠選びは原稿を書くAIに「意味で選ぶ」よう任せる（content_design_prompt.md）。
    """
    import math
    from workflows.daily_briefing.seed_db import SEED_SHEET, _blank, _rows_as_dicts  # noqa: E402
    from lib.xlsx_reader import read_workbook  # noqa: E402
    _, seeds = _rows_as_dicts(read_workbook(seed_xlsx)[SEED_SHEET])
    docs = []
    for s in seeds:
        if _blank(s) or not s.get("ID") or str(s["ID"]).upper().startswith("SAMPLE"):
            continue
        docs.append((s, _bigrams(" ".join(str(s.get(c) or "") for c in SEED_CORE_COLS))))
    n = max(len(docs), 1)
    df = {}
    for _, g in docs:
        for b in g:
            df[b] = df.get(b, 0) + 1
    default_idf = math.log(n + 1) + 1

    def vec(g):
        return {b: c * (math.log((n + 1) / (df.get(b, 0) + 1)) + 1 if b in df else default_idf) for b, c in g.items()}

    def cos(a, b):
        num = sum(v * b.get(k, 0) for k, v in a.items())
        den = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
        return num / den if den else 0.0

    vecs = [(s, vec(g)) for s, g in docs]
    for ins in insights:
        q = vec(_bigrams(ins["text"]))
        scored = sorted(((cos(q, v), s) for s, v in vecs), key=lambda x: -x[0])
        ins["facts"] = [{
            "seed_id": s.get("ID"),
            "theme": s.get("テーマ"),
            "title": s.get("情報源・タイトル"),
            "url": s.get("URL"),
            "fact": (s.get("FACT｜確認できた事実") or "")[:160],
            "similarity": round(sc, 3),
        } for sc, s in scored[:per_insight] if sc >= threshold]
    return insights


def _shorten(text):
    return text[:MAX_CHARS] + ("…（以下略）" if len(text) > MAX_CHARS else "")


def render_markdown(insights, withheld, stats, days, limit=30):
    now = now_jst()
    out = [
        "# Insight Digest（Obsidian から取り出した、本人の言葉）",
        "",
        "- 作成：%s　対象：直近%s日のノート %d 件 → 気づき %d 件" % (
            now.strftime("%Y-%m-%d %H:%M"), days, stats["notes"], len(insights)),
        "- 使い方：原稿・企画は、必ずこの中の **1つの INS を芯** にする。引用は「」で原文のまま。",
        "- 外部の根拠（Fact）は脇役。本人の言葉 7〜8割：Fact 2〜3割（LinkedIn の方針）。",
        "- ここに無い体験・発言を、本人のものとして書かないこと。",
        "",
    ]
    for ins in insights[:limit]:
        star = "★本人が発信候補に指定　" if ins["tagged"] else ""
        out += [
            "## %s｜%s%s（%s）" % (ins["id"], star, ins["kind"], "・".join(ins["themes"][:3]) or "テーマ未分類"),
            "- 出典ノート：%s（%s）%s" % (ins["note"], ins["date"], "／見出し：" + ins["heading"] if ins["heading"] else ""),
            "",
            "> " + _shorten(ins["text"]).replace("\n", "\n> "),
            "",
        ]
        for fct in ins.get("facts", []):
            out.append("- 根拠の候補（機械的な一致・近さ%.2f）：%s %s｜%s %s" % (
                fct["similarity"], fct["seed_id"], fct["theme"] or "", fct["title"] or "", fct["url"] or ""))
        if "facts" in ins and not ins["facts"]:
            out.append("- 根拠の候補：機械では見つからず（原稿を書くAIが、提案の種DBから意味で選ぶ）")
        out.append("")
    if len(insights) > limit:
        out.append("（ほか %d 件は点数が低いため省略）" % (len(insights) - limit))
    if withheld:
        out += ["", "## 要確認（個人が特定されうる記述のため、本文はAIに渡していません）"]
        out += ["- %s %s：%s" % (w["id"], w["note"], "・".join(w["reason"])) for w in withheld]
    return "\n".join(out) + "\n"


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
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Obsidian → Insight Digest")
    ap.add_argument("--vault", default=os.environ.get("VAULT_PATH"))
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--today", help="YYYY-MM-DD（テスト用）")
    ap.add_argument("--seed-xlsx", help="提案の種DBを xlsx で書き出したもの（任意）")
    ap.add_argument("--out", help="Markdown の保存先")
    ap.add_argument("--json", help="JSON の保存先（原稿の点検に使う）")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--scope", choices=["all", "marked"], default=os.environ.get("INSIGHT_SCOPE", "all"),
                    help="all＝全ノートから拾う／marked＝#発信候補 や「問い：」等の印があるものだけ")
    ap.add_argument("--state", default=STATE_FILE)
    ap.add_argument("--mark-used", nargs="+", metavar="INS_ID", help="使った気づきを記録（--json で作ったファイルが必要）")
    a = ap.parse_args(argv)

    state = load_state(a.state)
    if a.mark_used:
        if not a.json or not os.path.exists(a.json):
            ap.error("--mark-used には、その時の --json ファイルを指定してください")
        with open(a.json, encoding="utf-8") as f:
            data = json.load(f)
        by_id = {i["id"]: i for i in data["insights"]}
        today = now_jst().strftime("%Y-%m-%d")
        missing = [i for i in a.mark_used if i not in by_id]
        for i in a.mark_used:
            if i in by_id:
                state["used"][by_id[i]["hash"]] = {"id": i, "note": by_id[i]["note"], "used_on": today}
        save_state(state, a.state)
        print("使用済みに記録：%d 件%s" % (len(a.mark_used) - len(missing), ("（見つからないID：%s）" % ", ".join(missing)) if missing else ""))
        return 0

    if not a.vault:
        ap.error("--vault か config/local.env の VAULT_PATH を指定してください")
    today = dt.date.fromisoformat(a.today) if a.today else None
    try:
        insights, withheld, stats = collect(a.vault, a.days, today, used=state["used"], scope=a.scope)
    except FileNotFoundError as e:
        log_event("content_design", "error", str(e))
        print("[error]", e)
        return 2
    if a.seed_xlsx:
        attach_seeds(insights, a.seed_xlsx)

    level = "ok" if len(insights) >= 7 else "warn"
    msg = "気づき %d 件（ノート %d 件、要確認で除外 %d 件、使用済み %d 件）" % (
        len(insights), stats["notes"], len(withheld), stats["used_before"])
    if level == "warn":
        msg += "。7本の原稿には不足。数を合わせるより、本数を減らすか、本人に一言メモを頼む方がよい"
    log_event("content_design", level, msg)
    print("[%s] %s" % (level, msg))

    md = render_markdown(insights, withheld, stats, a.days, a.limit)
    for path, content in ((a.out, md), (a.json, None)):
        if not path:
            continue
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            if content is not None:
                f.write(content)
            else:
                json.dump({"generated_at": now_jst().isoformat(timespec="seconds"), "days": a.days,
                           "insights": insights, "withheld": withheld, "stats": stats},
                          f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        print("保存：", path)
    if not a.out and not a.json:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
