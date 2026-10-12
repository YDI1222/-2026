#!/usr/bin/env python3
"""提案の種DB（Google スプレッドシート）の健康診断と、重複なし登録のための判定。

使い方：
  # スプレッドシートを「Microsoft Excel(.xlsx)」でダウンロードしてから
  python3 seed_db.py check 提案の種DB.xlsx
  python3 seed_db.py check 提案の種DB.xlsx --today 2026-10-12 --json

  # 新しい候補（JSON）が既存と重複していないか、登録前に判定する
  python3 seed_db.py dedupe 提案の種DB.xlsx 新候補.json

スプレッドシート自体は一切書き換えません（読み取りのみ）。
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

HERE = os.path.dirname(os.path.abspath(__file__))
AIO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, AIO_ROOT)
from lib.common import log_event, now_jst  # noqa: E402
from lib.xlsx_reader import read_workbook  # noqa: E402

SEED_SHEET = "提案の種DB"
EVIDENCE_SHEET = "Seed Evidence Log"
STATUSES = {"Seed", "Insight", "Proposal", "Hold", "Archive"}
PRIORITIES = {"A", "B", "C"}
RELATION_TYPES = {"SUPPORT", "COUNTER", "EXPAND"}
DATE_RE = re.compile(r"^\d{4}/\d{2}/\d{2}$")
TRACKING_PARAMS = re.compile(r"^(utm_|fbclid|gclid|mc_|ref$|ref_src$)")


# ---------- 重複判定の基本 ----------
def normalize_url(url):
    """同じ記事を別のURL表記で二重登録しないための正規化。"""
    if not url:
        return ""
    url = url.strip()
    parts = urlsplit(url)
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    query = [(k, v) for k, v in parse_qsl(parts.query) if not TRACKING_PARAMS.match(k)]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", host, path, urlencode(query), ""))


def _rows_as_dicts(sheet):
    values = sheet["values"]
    if not values:
        return [], []
    header = [h or "" for h in values[0]]
    out = []
    for i, row in enumerate(values[1:], start=2):  # 2 = スプレッドシート上の行番号
        d = {header[c]: (row[c] if c < len(row) else None) for c in range(len(header)) if header[c]}
        d["_row"] = i
        out.append(d)
    return header, out


def _blank(d):
    return all(v in (None, "") for k, v in d.items() if k != "_row")


def _col(header, startswith):
    for h in header:
        if h.startswith(startswith):
            return h
    return None


# ---------- 健康診断 ----------
def check(xlsx_path, today=None):
    wb = read_workbook(xlsx_path)
    today = today or now_jst().date()
    issues = []  # (重要度, 内容)

    def add(level, msg):
        issues.append({"level": level, "message": msg})

    seed_header, seeds = _rows_as_dicts(wb[SEED_SHEET])
    ev_header, evs = _rows_as_dicts(wb[EVIDENCE_SHEET])

    # 末尾の空行は無視し、途中の空行だけを問題にする
    while seeds and _blank(seeds[-1]):
        seeds.pop()
    while evs and _blank(evs[-1]):
        evs.pop()

    url_col = "URL"
    seen_ids, seen_urls, seed_ids = {}, {}, set()
    for s in seeds:
        if _blank(s):
            add("warn", "提案の種DB：%d行目が空行です（並べ替え・集計がずれる原因）" % s["_row"])
            continue
        sid = s.get("ID")
        if not sid:
            add("error", "提案の種DB：%d行目にIDがありません" % s["_row"])
            continue
        if str(sid).upper().startswith("SAMPLE"):
            add("info", "提案の種DB：%d行目はサンプル（%s）です。集計から外すか削除を検討" % (s["_row"], sid))
        if sid in seen_ids:
            add("error", "提案の種DB：ID %s が重複（%d行目と%d行目）" % (sid, seen_ids[sid], s["_row"]))
        seen_ids[sid] = s["_row"]
        seed_ids.add(sid)
        nu = normalize_url(s.get(url_col))
        if nu:
            if nu in seen_urls:
                add("warn", "提案の種DB：同じ情報源URLが重複（%d行目と%d行目）" % (seen_urls[nu], s["_row"]))
            seen_urls[nu] = s["_row"]
        if s.get("発見日") and not DATE_RE.match(str(s["発見日"])):
            add("warn", "提案の種DB：%d行目の発見日の形式が違います（%s）" % (s["_row"], s["発見日"]))
        if s.get("STATUS") and s["STATUS"] not in STATUSES:
            add("warn", "提案の種DB：%d行目のSTATUSが規定外（%s）" % (s["_row"], s["STATUS"]))
        if s.get("優先度") and s["優先度"] not in PRIORITIES:
            add("warn", "提案の種DB：%d行目の優先度が規定外（%s）" % (s["_row"], s["優先度"]))

    # 証拠ログ
    ev_ids, ev_pairs, names, dates = {}, {}, {}, []
    url_ev = _col(ev_header, "URL") or "URL"
    for e in evs:
        if _blank(e):
            add("warn", "Seed Evidence Log：%d行目が空行です" % e["_row"])
            continue
        eid, sid = e.get("Evidence ID"), e.get("Seed ID")
        if eid in ev_ids:
            add("error", "Seed Evidence Log：Evidence ID %s が重複" % eid)
        ev_ids[eid] = e["_row"]
        if sid not in seed_ids:
            add("error", "Seed Evidence Log：%d行目のSeed ID（%s）が提案の種DBに存在しません" % (e["_row"], sid))
        pair = (sid, normalize_url(e.get(url_ev)))
        if pair[1] and pair in ev_pairs:
            add("warn", "Seed Evidence Log：同じSeedに同じ情報源が二重登録（%d行目と%d行目）" % (ev_pairs[pair], e["_row"]))
        ev_pairs[pair] = e["_row"]
        if e.get("関係タイプ") not in RELATION_TYPES:
            add("warn", "Seed Evidence Log：%d行目の関係タイプが規定外（%s）" % (e["_row"], e.get("関係タイプ")))
        names.setdefault(sid, set()).add(e.get("Seed名"))
        d = str(e.get("発見日") or "")
        if DATE_RE.match(d):
            dates.append(dt.datetime.strptime(d, "%Y/%m/%d").date())
        else:
            add("warn", "Seed Evidence Log：%d行目の発見日の形式が違います（%s）" % (e["_row"], d))

    inconsistent = {k: sorted(v - {None}) for k, v in names.items() if len(v - {None}) > 1}
    if inconsistent:
        add("info", "Seed Evidence Log：同じSeed IDに別々のSeed名が使われています（%d件）。"
                    "Seed名は提案の種DBから自動で引く形にすると揃います" % len(inconsistent))

    # 集計列が機能しているか（最終Evidence日）
    last_col = _col(seed_header, "最終Evidence")
    if last_col:
        with_ev = [s for s in seeds if not _blank(s) and s.get("ID") in {e.get("Seed ID") for e in evs}]
        filled = [s for s in with_ev if s.get(last_col) and DATE_RE.match(str(s.get(last_col)))]
        if with_ev and not filled:
            add("error", "提案の種DB：「最終Evidence日」が全行で空欄・異常値です（証拠は%d件のSeedにあるのに未計算）。"
                         "数式の修正が必要（docs/03 の修正案参照）" % len(with_ev))

    # 鮮度：毎日の自動処理が止まっていないか
    latest = max(dates) if dates else None
    lag = (today - latest).days if latest else None
    if latest is None:
        add("error", "Seed Evidence Log：日付付きの記録がありません")
    elif lag > 2:
        add("error", "最終記録が %s（%d日前）。毎日の自動処理が止まっている可能性" % (latest, lag))
    gaps = []
    if dates:
        uniq = sorted(set(dates))
        for a, b in zip(uniq, uniq[1:]):
            if (b - a).days == 2:
                gaps.append(str(a + dt.timedelta(days=1)))
            elif (b - a).days > 2:
                gaps.append("%s〜%s" % (a + dt.timedelta(days=1), b - dt.timedelta(days=1)))

    summary = {
        "seeds": len([s for s in seeds if not _blank(s)]),
        "evidence": len([e for e in evs if not _blank(e)]),
        "latest_evidence_date": str(latest) if latest else None,
        "days_since_latest": lag,
        "missing_days": gaps,
        "errors": sum(1 for i in issues if i["level"] == "error"),
        "warnings": sum(1 for i in issues if i["level"] == "warn"),
    }
    return {"summary": summary, "issues": issues}


# ---------- 登録前の重複チェック ----------
def dedupe(xlsx_path, candidates):
    """candidates: [{"kind": "seed"|"evidence", "seed_id"?, "url", ...}]
    既存と重複するものを除いた new と、除いた理由つきの skipped を返す。"""
    wb = read_workbook(xlsx_path)
    _, seeds = _rows_as_dicts(wb[SEED_SHEET])
    _, evs = _rows_as_dicts(wb[EVIDENCE_SHEET])
    seed_urls = {normalize_url(s.get("URL")) for s in seeds if s.get("URL")}
    ev_pairs = {(e.get("Seed ID"), normalize_url(e.get("URL"))) for e in evs if e.get("URL")}
    new, skipped, batch = [], [], set()
    for c in candidates:
        nu = normalize_url(c.get("url"))
        key = (c.get("kind"), c.get("seed_id"), nu)
        if not nu:
            skipped.append(dict(c, reason="URLがない（出典不明のため登録しない）"))
        elif key in batch:
            skipped.append(dict(c, reason="今回の候補内で重複"))
        elif c.get("kind") == "seed" and nu in seed_urls:
            skipped.append(dict(c, reason="同じ情報源のSeedが既にある"))
        elif c.get("kind") == "evidence" and (c.get("seed_id"), nu) in ev_pairs:
            skipped.append(dict(c, reason="同じSeedに同じ情報源の証拠が既にある"))
        else:
            new.append(c)
        batch.add(key)
    return new, skipped


def _print_report(result):
    s = result["summary"]
    print("提案の種DB 健康診断")
    print("  Seed %d件／証拠 %d件／最終記録 %s（%s日前）" % (
        s["seeds"], s["evidence"], s["latest_evidence_date"], s["days_since_latest"]))
    if s["missing_days"]:
        print("  記録が無い日：", "、".join(s["missing_days"]))
    for i in result["issues"]:
        print("  [%s] %s" % ({"error": "エラー", "warn": "警告", "info": "参考"}[i["level"]], i["message"]))
    if not result["issues"]:
        print("  問題は見つかりませんでした")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("xlsx")
    c.add_argument("--today", help="YYYY-MM-DD（省略時は今日）")
    c.add_argument("--json", action="store_true")
    d = sub.add_parser("dedupe")
    d.add_argument("xlsx")
    d.add_argument("candidates_json")
    a = ap.parse_args(argv)

    if a.cmd == "check":
        today = dt.date.fromisoformat(a.today) if a.today else None
        result = check(a.xlsx, today)
        s = result["summary"]
        log_event("daily_briefing", "error" if s["errors"] else ("warn" if s["warnings"] else "ok"),
                  "提案の種DB 健康診断", **s)
        if a.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            _print_report(result)
        return 1 if s["errors"] else 0

    with open(a.candidates_json, encoding="utf-8") as f:
        cands = json.load(f)
    new, skipped = dedupe(a.xlsx, cands)
    log_event("daily_briefing", "ok", "登録前の重複チェック", new=len(new), skipped=len(skipped))
    print(json.dumps({"new": new, "skipped": skipped}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
