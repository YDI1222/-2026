"""Obsidian → コンテンツ設計（Insight Digest・本人の言葉の照合）のテスト。

実行：cd AI_Orchestration && python3 -m unittest discover -s tests -v
"""

import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
os.environ.setdefault("AIO_LOG_DIR", tempfile.mkdtemp(prefix="aio_logs_"))

from test_workflows import EV_HEADER, make_xlsx  # noqa: E402
from workflows.content_design import insight_digest as dg  # noqa: E402
from workflows.sns_weekly import validate_weekly_draft as vw  # noqa: E402

VAULT = os.path.join(HERE, "fixtures", "vault_content")
TODAY = dt.date(2026, 10, 12)
EXCLUDES = ["業務記録/*"]


def collect(**kw):
    kw.setdefault("excludes", EXCLUDES)
    return dg.collect(VAULT, 14, TODAY, **kw)


class InsightCollectTest(unittest.TestCase):
    def test_picks_own_voice_and_skips_the_rest(self):
        ins, withheld, stats = collect()
        ids = {i["id"]: i for i in ins}
        self.assertIn("INS-20261012-1", ids)                       # 問い＋考え
        self.assertEqual(ids["INS-20261012-1"]["kind"], "問い")
        self.assertEqual(ids["INS-20261007-3"]["kind"], "体験")     # 研修での体験
        self.assertTrue(ids["INS-20261010-1"]["tagged"])            # フロントマターの #発信候補
        texts = " ".join(i["text"] for i in ins)
        self.assertNotIn("社会通念上", texts)   # ニュースの書き写しは本人の言葉ではない
        self.assertNotIn("牛乳", texts)         # 短いメモ
        self.assertNotIn("期間外", texts)       # 14日より前
        self.assertNotIn("業務記録は読まない", texts)
        self.assertEqual(stats["not_own_voice"], 1)

    def test_identifiable_text_is_withheld_not_shown(self):
        ins, withheld, _ = collect()
        self.assertEqual([w["note"] for w in withheld], ["Daily/2026-10-11.md"])
        self.assertNotIn("tanaka", json.dumps(ins, ensure_ascii=False))
        md = dg.render_markdown(ins, withheld, {"notes": 4}, 14)
        self.assertNotIn("tanaka", md)
        self.assertIn("要確認", md)

    def test_ids_are_stable_between_runs(self):
        a = [i["id"] for i in collect()[0]]
        b = [i["id"] for i in collect()[0]]
        self.assertEqual(a, b)

    def test_tagged_and_high_score_come_first(self):
        ins, _, _ = collect()
        scores = [i["score"] for i in ins]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_explicit_label_is_respected(self):
        self.assertEqual(dg.classify("問い：健康診断の結果を、本人が自分の言葉で語れる場はあるだろうか"), ("問い", 10))
        self.assertEqual(dg.classify("体験：今日の講演で、会場の空気が変わる瞬間があった"), ("体験", 10))

    def test_marked_scope_uses_only_marked_blocks(self):
        ins, _, _ = collect(scope="marked")
        self.assertEqual([i["id"] for i in ins], ["INS-20261010-1"])  # #発信候補 のノートだけ

    def test_used_insights_are_skipped(self):
        tmp = tempfile.mkdtemp()
        js, st = os.path.join(tmp, "d.json"), os.path.join(tmp, "used.json")
        self.assertEqual(dg.main(["--vault", VAULT, "--today", "2026-10-12", "--json", js, "--state", st]), 0)
        self.assertEqual(dg.main(["--mark-used", "INS-20261012-1", "--json", js, "--state", st]), 0)
        with open(st, encoding="utf-8") as f:
            used = json.load(f)["used"]
        ins, _, stats = collect(used=used)
        self.assertNotIn("INS-20261012-1", [i["id"] for i in ins])
        self.assertEqual(stats["used_before"], 1)


class SeedMatchTest(unittest.TestCase):
    def test_close_seed_is_suggested_and_weak_ones_are_not(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "db.xlsx")
        header = ["ID", "発見日", "テーマ", "情報源・タイトル", "URL", "SEED｜提案の種", "QUESTION｜育てる問い"]
        seeds = [header,
                 ["S-1", "2026/09/26", "職場環境 × 回復", "某社｜オフィス環境", "https://a.example/1",
                  "健康で働きやすい環境を組織がつくる職場環境への介入と継続的な評価", "環境への介入は健康経営になるか"],
                 ["S-2", "2026/09/16", "宇宙 × 天文", "某機関｜星", "https://b.example/2", "天体観測の新手法", "星はなぜ光るか"]]
        make_xlsx(path, {"提案の種DB": (seeds, {}), "Seed Evidence Log": ([EV_HEADER], {})})
        ins, _, _ = collect()
        dg.attach_seeds(ins, path)
        target = [i for i in ins if i["id"] == "INS-20261012-1"][0]
        self.assertEqual([f["seed_id"] for f in target["facts"]], ["S-1"])
        self.assertTrue(all(f["seed_id"] != "S-2" for i in ins for f in i["facts"]))


def _anchored_draft(refs, days=7, short=None):
    wd = "月火水木金土日"
    lines = ["ステータス：確認待ち（人の目で確認後に投稿）"]
    if short:
        lines.append("不足：%d本。本人に聞きたいこと：最近の研修での気づき" % short)
    for i in range(days):
        lines.append("10/%d（%s）｜テーマ" % (19 + i, wd[i % 7]))
        if i < len(refs) and refs[i]:
            lines.append("元ネタ：%s" % refs[i])
        for p in vw.PLATFORMS:
            lines += ["【%s】" % p, "本文 https://www.mhlw.go.jp/" if p == "LinkedIn" else "本文"]
    return "\n".join(lines)


class OriginalityCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ins, _, _ = collect()
        cls.digest = {"insights": ins}

    def test_verbatim_quotes_pass(self):
        refs = ["INS-20261012-1「どこまで役割を広げるべきなのか？」",
                "INS-20261010-1「そこで止まってしまうんですよね。」",
                "INS-20261007-3「仕組みで守るという発想が、まだ届いていない」",
                "INS-20261007-1「小さなシステムを職場に実装することではないか」"]
        r = vw.validate(_anchored_draft(refs), digest=self.digest)
        self.assertEqual(r["originality"]["anchored_days"], 4)
        self.assertFalse(r["errors"], r)

    def test_fabricated_quote_is_an_error(self):
        refs = ["INS-20261012-1「健康経営はROIで説明できると確信しています」"]
        r = vw.validate(_anchored_draft(refs), digest=self.digest, min_anchored=1)
        self.assertTrue(any("一致しません" in e for e in r["errors"]))

    def test_unknown_id_and_too_few_anchors(self):
        r = vw.validate(_anchored_draft(["INS-20990101-1「架空」"]), digest=self.digest)
        msgs = " ".join(r["errors"])
        self.assertIn("Insight Digest にありません", msgs)
        self.assertIn("芯になっている日が 0 / 7", msgs)

    def test_quote_spanning_linebreak_matches(self):
        # 原文の改行をまたぐ引用も、改行を詰めれば一致とみなす
        q = "INS-20261012-1「べきなのか？個人への支援」"
        r = vw.validate(_anchored_draft([q]), digest=self.digest, min_anchored=1)
        self.assertEqual(r["originality"]["anchored_days"], 1)

    def test_declared_shortfall_is_accepted(self):
        refs = [
            "INS-20261012-1「どこまで役割を広げるべきなのか？」",
            "INS-20261010-1「そこで止まってしまうんですよね。」",
            "INS-20261007-3「仕組みで守るという発想が、まだ届いていない」",
            "INS-20261007-1「小さなシステムを職場に実装することではないか」"]
        r = vw.validate(_anchored_draft(refs, days=4, short=3), digest=self.digest)
        self.assertTrue(r["ok"], r)
        self.assertTrue(any("減らしています" in w for w in r["warnings"]))

    def test_without_digest_behaves_as_before(self):
        r = vw.validate(_anchored_draft([]))
        self.assertNotIn("originality", r)
        self.assertEqual(r["level"], 0)


@unittest.skipUnless(shutil.which("rsync") and shutil.which("bash"), "rsync が無い環境")
class SyncDigestTest(unittest.TestCase):
    def test_sync_writes_digest_and_never_deletes_it(self):
        tmp = tempfile.mkdtemp()
        vault, dest = os.path.join(tmp, "vault"), os.path.join(tmp, "drive", "Second Brain")
        shutil.copytree(VAULT, vault)
        os.makedirs(dest)
        conf = os.path.join(tmp, "local.env")
        with open(conf, "w", encoding="utf-8") as f:
            f.write('VAULT_PATH="%s"\nDRIVE_DEST="%s"\nPRIMARY_HOST=""\nOPEN_OBSIDIAN_BEFORE_SYNC=0\nMIRROR_DELETE=1\n'
                    'INSIGHT_DAYS=0\n' % (vault, dest))  # 0＝全期間（実行日に左右されないように）
        env = dict(os.environ, AIO_CONFIG=conf, AIO_LOG_DIR=os.path.join(tmp, "logs"))
        script = os.path.join(ROOT, "workflows", "obsidian_sync", "sync_to_drive.sh")
        for _ in range(2):  # 2回目：削除反映モードでも _AI_digest は消えない
            r = subprocess.run(["bash", script, "--apply"], env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Insight Digest を更新", r.stdout)
        with open(os.path.join(dest, "_AI_digest", "insight_digest_latest.json"), encoding="utf-8") as f:
            data = json.load(f)
        self.assertTrue(data["insights"])
        self.assertFalse(os.path.exists(os.path.join(vault, "_AI_digest")))  # 保管庫には書かない


if __name__ == "__main__":
    unittest.main()
