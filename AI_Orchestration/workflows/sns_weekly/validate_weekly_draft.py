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


def validate(text, expected_days=7):
    errors, warnings = [], []
    stripped = text.strip()
    if not stripped:
        return {"ok": False, "level": 2, "errors": ["中身が空です（生成に失敗した可能性）"], "warnings": [], "days": 0}

    if "確認待ち" not in stripped[:500]:
        warnings.append("冒頭に「確認待ち」の表示がありません（承認前に公開されるおそれ）")

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

    level = 2 if errors else (1 if warnings else 0)
    return {"ok": not errors, "level": level, "errors": errors, "warnings": warnings, "days": len(days)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    with open(a.path, encoding="utf-8") as f:
        result = validate(f.read(), a.days)
    if a.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("判定：", ["問題なし", "要修正（警告）", "使えない"][result["level"]], "／%d日分" % result["days"])
        for e in result["errors"]:
            print("  [エラー]", e)
        for w in result["warnings"]:
            print("  [警告]", w)
    return result["level"]


if __name__ == "__main__":
    sys.exit(main())
