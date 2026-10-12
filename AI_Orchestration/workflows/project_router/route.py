#!/usr/bin/env python3
"""受付係：依頼文から「どの区分か・どこまでAIに任せるか・どこで承認を挟むか・どのAIに渡すか」を提案する。

使い方：
  python3 route.py "健康経営に関する企業提案書を作りたい"
  python3 route.py "..." --write          # 引き継ぎ票を shared/inbox/ に作る
  python3 route.py --move 票.md working   # 引き継ぎ票を working/review/completed へ進める

これはキーワードによる「提案」です。判定に迷った時（該当なし・同点）は人間に確認します。
ルールは config/router_rules.json（受付係 指示書 v1 の区分A〜H）で変更できます。
"""

import argparse
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AIO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, AIO_ROOT)
from lib.common import keyword_hits, log_event, now_jst  # noqa: E402

RULES_PATH = os.path.join(AIO_ROOT, "config", "router_rules.json")
SHARED = os.path.join(AIO_ROOT, "shared")
STATES = ["inbox", "working", "review", "completed"]
LEVELS = ["L0", "L1", "L2", "L3"]


def load_rules(path=RULES_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _hits(text, keywords):
    return keyword_hits(text, keywords)


def route(request, rules=None):
    rules = rules or load_rules()
    # 「提案の種DB」のような仕組みの名前に含まれる語（提案）で誤判定しないよう、先に取り除く
    text = request
    for phrase in sorted(rules.get("ignore_phrases", []), key=len, reverse=True):
        text = text.replace(phrase, " ")
    scored = []
    for cat in rules["categories"]:
        h = _hits(text, cat["keywords"])
        if h:
            scored.append((len(h), cat, h))
    scored.sort(key=lambda x: -x[0])

    if not scored:
        return {"request": request, "decision": "要確認", "reason": "どの区分にも当てはまりません。目的を一言添えてください（例：『提案書として』『SNS用に』）"}

    top_score = scored[0][0]
    tied = [s for s in scored if s[0] == top_score]
    if len(tied) > 1:
        # 同点でも、一方が他方を工程として含むなら（例：研修設計Aは根拠集めEを含む）含む側を選ぶ
        ids = {c["id"] for _, c, _ in tied}
        umbrella = [s for s in tied if ids - {s[1]["id"]} <= set(s[1].get("includes", []))]
        if umbrella:
            scored.remove(umbrella[0])
            scored.insert(0, umbrella[0])
            tied = [umbrella[0]]
    primary = scored[0][1]
    related = [{"id": c["id"], "name": c["name"], "matched": h} for _, c, h in scored[1:]]

    level = primary["autonomy"]
    reasons = []
    approvals = list(primary["approvals"])
    for group, kws in rules["downgrade_keywords"].items():
        hit = _hits(text, kws)
        if not hit:
            continue
        # L1以下の区分は、もともと「外に出す前」の承認が組み込まれているので重ねて下げない
        if level in ("L2", "L3"):
            level = LEVELS[LEVELS.index(level) - 1]
            reasons.append("%s（%s）のため1段階下げ" % (group, "・".join(hit)))
        if group == "個人・健康情報":
            approvals.append("個人・健康情報をAIに渡す前の確認（氏名は入れずID化・対応表は渡さない）")

    result = {
        "request": request,
        "decision": "要確認" if len(tied) > 1 else "提案",
        "category": {"id": primary["id"], "name": primary["name"], "matched": scored[0][2]},
        "related_categories": related,
        "autonomy": level,
        "autonomy_meaning": rules["autonomy_levels"][level],
        "autonomy_reasons": reasons,
        "approvals": approvals,
        "chain": primary["chain"],
    }
    if len(tied) > 1:
        result["reason"] = "区分が同点です（%s）。どちらが主目的か確認してください" % "・".join(c["id"] + c["name"] for _, c, _ in tied)
    return result


def render_handoff(r):
    now = now_jst()
    lines = [
        "# 引き継ぎ票",
        "",
        "- ID：%s" % now.strftime("%Y%m%d-%H%M%S"),
        "- 作成：%s（受付係・自動提案）" % now.strftime("%Y-%m-%d %H:%M"),
        "- 状態：inbox",
        "",
        "## 依頼",
        r["request"],
        "",
        "## 判定（受付係の提案）",
    ]
    if r["decision"] == "要確認" and "category" not in r:
        lines += ["- **要確認**：" + r["reason"]]
    else:
        lines += [
            "- 区分：%s %s（一致：%s）" % (r["category"]["id"], r["category"]["name"], "・".join(r["category"]["matched"])),
            "- 任せ方：%s ＝ %s" % (r["autonomy"], r["autonomy_meaning"]),
        ]
        lines += ["- 調整理由：" + x for x in r["autonomy_reasons"]]
        if r.get("reason"):
            lines += ["- **要確認**：" + r["reason"]]
        lines += ["", "## 承認ポイント（人間）"]
        lines += ["- [ ] " + a for a in r["approvals"]] or ["- なし（結果だけ記録）"]
        lines += ["", "## 作業の流れ（担当AIは推奨。接続状況で変更可）", "| # | 工程 | 担当 | つなぎ方 | 状態 |", "|---|---|---|---|---|"]
        for i, s in enumerate(r["chain"], 1):
            lines.append("| %d | %s | %s | %s | 未着手 |" % (i, s["step"], s["ai"], s["how"]))
    lines += [
        "",
        "## 入力（参照する資料の場所）",
        "- ",
        "",
        "## 完成の条件",
        "- ",
        "",
        "## 検証（誰が・何で確かめたか）",
        "- ",
        "",
        "## 記録",
        "- %s inbox に作成" % now.strftime("%Y-%m-%d %H:%M"),
    ]
    return "\n".join(lines) + "\n"


def write_handoff(r, shared=SHARED):
    os.makedirs(os.path.join(shared, "inbox"), exist_ok=True)
    slug = re.sub(r"[^\w]+", "_", r["request"])[:24].strip("_")
    path = os.path.join(shared, "inbox", "%s_%s.md" % (now_jst().strftime("%Y%m%d_%H%M%S"), slug))
    with open(path, "w", encoding="utf-8") as f:
        f.write(render_handoff(r))
    return path


def move_handoff(path, state, note="", shared=SHARED):
    if state not in STATES:
        raise ValueError("状態は %s のいずれか" % "/".join(STATES))
    with open(path, encoding="utf-8") as f:
        text = f.read()
    stamp = now_jst().strftime("%Y-%m-%d %H:%M")
    text = re.sub(r"(?m)^- 状態：\w+$", "- 状態：" + state, text, count=1)
    text = text.rstrip("\n") + "\n- %s %s へ移動%s\n" % (stamp, state, ("：" + note) if note else "")
    dest_dir = os.path.join(shared, state)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(path))
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, dest)
    if os.path.abspath(dest) != os.path.abspath(path):
        os.remove(path)
    return dest


def main(argv=None):
    ap = argparse.ArgumentParser(description="受付係")
    ap.add_argument("request", nargs="?")
    ap.add_argument("--write", action="store_true", help="引き継ぎ票を shared/inbox に作成")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--move", nargs=2, metavar=("票", "状態"))
    ap.add_argument("--note", default="")
    a = ap.parse_args(argv)

    if a.move:
        dest = move_handoff(a.move[0], a.move[1], a.note)
        log_event("project_router", "ok", "引き継ぎ票を移動", to=a.move[1], file=os.path.basename(dest))
        print("移動しました：", dest)
        return 0
    if not a.request:
        ap.error("依頼文を指定してください")

    r = route(a.request)
    log_event("project_router", "ok" if r["decision"] == "提案" else "warn", "受付判定",
              category=r.get("category", {}).get("id"), autonomy=r.get("autonomy"), decision=r["decision"])
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print(render_handoff(r))
    if a.write:
        print("作成しました：", write_handoff(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
