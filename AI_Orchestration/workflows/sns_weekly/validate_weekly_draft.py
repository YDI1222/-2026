#!/usr/bin/env python3
"""週次SNS原稿（Googleドキュメントをテキストにしたもの）が「使える状態」かを点検する。

使い方：
  python3 validate_weekly_draft.py 原稿.txt
  python3 validate_weekly_draft.py 原稿.txt --json

2026-10-10 生成分のように「ファイルはあるが中身が空」の失敗を見逃さないためのもの。
点検項目：
  - 中身があるか
  - 「確認待ち」の表示があるか（本人承認前の公開を防ぐ）
  - 7日分の見出しがあるか
  - 各日に Facebook / Instagram / LinkedIn / X の4媒体がそろっているか
  - LinkedIn に参考（出典URL）があるか
  - X が長すぎないか（全角140字の目安）
  - （--digest を渡した時）各日が Obsidian の気づき（INS）を芯にしているか、
    「元ネタ」の引用が本人の原文と一字一句一致するか（AIによる「本人の言葉」の創作を防ぐ）
終了コード：0=問題なし、1=要修正（警告のみ）、2=使えない（空・日数不足など）
"""

import argparse
import json
import re
import sys

PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "X"]
DAY_HEADING = re.compile(r"(?m)^\s*(\d{1,2})/(\d{1,2})[（(]([月火水木金土日])[）)]")
SECTION = re.compile(r"【(Facebook|Instagram|LinkedIn|X)】")
X_LIMIT = 140
INS_REF = re.compile(r"(INS-\d{8}-\d+)(?:\s*「([^」]*)」)?")
MIN_QUOTE = 10


def split_days(text):
    marks = list(DAY_HEADING.finditer(text))
    days = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        days.append(("%s/%s（%s）" % m.groups(), text[m.start():end]))
    return days


def split_platforms(day_text):
    marks = list(SECTION.finditer(day_text))
    out = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(day_text)
        body = day_text[m.end():end]
        # X の後ろの「画像案／CTA／要確認事項」は投稿本文ではない
        body = re.split(r"(?m)^\s*(画像案|CTA|要確認事項)[：:]", body)[0]
        out[m.group(1)] = body.strip()
    return out


def validate(text, expected_days=7, digest=None, min_anchored=4):
    errors, warnings = [], []
    stripped = text.strip()
    if not stripped:
        return {"ok": False, "level": 2, "errors": ["中身が空です（生成に失敗した可能性）"], "warnings": [], "days": 0}

    if "確認待ち" not in stripped[:500]:
        warnings.append("冒頭に「確認待ち」の表示がありません（承認前に公開されるおそれ）")

    # 材料（本人の言葉）が足りない週は、創作せず本数を減らすのが正しい判断（content_design_prompt.md ルール3）
    short = re.search(r"不足[：:]\s*(\d+)\s*本", stripped)
    if short:
        expected_days = max(expected_days - int(short.group(1)), 1)
        warnings.append("本人の言葉が足りず %s 本減らしています（創作を避けた正常な判断。補足メモの依頼を確認）" % short.group(1))

    days = split_days(stripped)
    if len(days) < expected_days:
        errors.append("日数が足りません：%d / %d 日" % (len(days), expected_days))

    for label, body in days:
        sections = split_platforms(body)
        missing = [p for p in PLATFORMS if not sections.get(p)]
        if missing:
            errors.append("%s：%s がありません" % (label, "・".join(missing)))
        li = sections.get("LinkedIn", "")
        if li and not re.search(r"https?://", li):
            warnings.append("%s：LinkedIn に出典URLがありません" % label)
        x = re.sub(r"\s+", "", sections.get("X", ""))
        if len(x) > X_LIMIT:
            warnings.append("%s：X が %d 字（目安 %d 字）" % (label, len(x), X_LIMIT))

    originality = None
    if digest is not None:
        originality = check_originality(days, digest, min_anchored, errors, warnings)

    level = 2 if errors else (1 if warnings else 0)
    result = {"ok": not errors, "level": level, "errors": errors, "warnings": warnings, "days": len(days)}
    if originality is not None:
        result["originality"] = originality
    return result


def _norm(t):
    return re.sub(r"[\s　]+", "", t or "")


def check_originality(days, digest, min_anchored, errors, warnings):
    """各日の「元ネタ：INS-…「引用」」を Insight Digest の原文と照合する。"""
    by_id = {i["id"]: _norm(i["text"]) for i in digest.get("insights", [])}
    anchored, used_ids = 0, []
    for label, body in days:
        refs = INS_REF.findall(body)
        if not refs:
            warnings.append("%s：Obsidian の気づき（INS）が元ネタになっていません" % label)
            continue
        day_ok = False
        for ins_id, quote in refs:
            used_ids.append(ins_id)
            if ins_id not in by_id:
                errors.append("%s：%s は Insight Digest にありません" % (label, ins_id))
                continue
            if not quote:
                warnings.append("%s：%s の引用（「」）がありません" % (label, ins_id))
                day_ok = True
                continue
            if _norm(quote) not in by_id[ins_id]:
                errors.append("%s：%s の引用「%s」が本人の原文と一致しません（言葉の創作・書き換えの疑い）" % (
                    label, ins_id, quote[:30]))
                continue
            if len(_norm(quote)) < MIN_QUOTE:
                warnings.append("%s：%s の引用が短すぎます（%d字）" % (label, ins_id, len(_norm(quote))))
            day_ok = True
        anchored += 1 if day_ok else 0
    dup = sorted({i for i in used_ids if used_ids.count(i) > 1})
    if dup:
        warnings.append("同じ気づきを複数の日で使っています：%s" % "、".join(dup))
    if days and anchored < min(min_anchored, len(days)):
        errors.append("本人の言葉が芯になっている日が %d / %d 日（目標 %d 日以上）" % (anchored, len(days), min_anchored))
    return {"anchored_days": anchored, "insights_used": sorted(set(used_ids))}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--digest", help="insight_digest.py --json で作ったファイル（本人の言葉の照合）")
    ap.add_argument("--min-anchored", type=int, default=4, help="INSを芯にすべき最低日数")
    a = ap.parse_args(argv)
    digest = None
    if a.digest:
        with open(a.digest, encoding="utf-8") as f:
            digest = json.load(f)
    with open(a.path, encoding="utf-8") as f:
        result = validate(f.read(), a.days, digest, a.min_anchored)
    if a.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("判定：", ["問題なし", "要修正（警告）", "使えない"][result["level"]], "／%d日分" % result["days"])
        if "originality" in result:
            print("本人の言葉が芯になっている日：%d 日" % result["originality"]["anchored_days"])
        for e in result["errors"]:
            print("  [エラー]", e)
        for w in result["warnings"]:
            print("  [警告]", w)
    return result["level"]


if __name__ == "__main__":
    sys.exit(main())
