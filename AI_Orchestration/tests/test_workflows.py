"""全ワークフローのテスト（標準ライブラリのみ・外部サービスに接続しない）。

実行：
  cd AI_Orchestration && python3 -m unittest discover -s tests -v
"""

import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
os.environ["AIO_LOG_DIR"] = tempfile.mkdtemp(prefix="aio_logs_")

from lib import common  # noqa: E402
from workflows.daily_briefing import seed_db  # noqa: E402
from workflows.project_router import route  # noqa: E402
from workflows.sns_weekly import extract_candidates as ec  # noqa: E402
from workflows.sns_weekly import validate_weekly_draft as vw  # noqa: E402

VAULT = os.path.join(HERE, "fixtures", "vault")
SYNC = os.path.join(ROOT, "workflows", "obsidian_sync", "sync_to_drive.sh")


# ---------- テスト用の最小xlsxを作る ----------
def _col(n):
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _sheet_xml(rows, formulas=None):
    formulas = formulas or {}
    out = ['<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for r, row in enumerate(rows):
        out.append('<row r="%d">' % (r + 1))
        for c, v in enumerate(row):
            ref = "%s%d" % (_col(c), r + 1)
            f = formulas.get((r, c))
            fx = "<f>%s</f>" % escape(f) if f else ""
            if v is None:
                out.append('<c r="%s">%s</c>' % (ref, fx))
            else:
                out.append('<c r="%s" t="inlineStr">%s<is><t>%s</t></is></c>' % (ref, fx, escape(str(v))))
        out.append("</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out)


def make_xlsx(path, sheets):
    names = list(sheets)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml",
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(n), i + 1, i + 1) for i, n in enumerate(names))
                   + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join('<Relationship Id="rId%d" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(len(names)))
                   + "</Relationships>")
        for i, n in enumerate(names):
            rows, formulas = sheets[n]
            z.writestr("xl/worksheets/sheet%d.xml" % (i + 1), _sheet_xml(rows, formulas))


SEED_HEADER = ["ID", "発見日", "テーマ", "情報源・タイトル", "URL", "STATUS", "優先度", "最終Evidence日"]
EV_HEADER = ["Evidence ID", "発見日", "Seed ID", "Seed名", "関係タイプ", "情報源・タイトル", "URL"]


def seed_workbook(path, last_dates=(None, None), extra_seed_rows=(), extra_ev_rows=()):
    seeds = [SEED_HEADER,
             ["SAMPLE-001", "2026/09/16", "サンプル", "サンプル", "", "Seed", "B", None],
             ["20260916-01", "2026/09/16", "AI", "WHO", "https://www.who.int/news/a?utm_source=x", "Seed", "A", last_dates[0]],
             [None] * 8,
             ["20260917-01", "2026/09/17", "医療AI", "Nature", "https://nature.com/b/", "Seed", "A", last_dates[1]]]
    seeds += list(extra_seed_rows)
    evs = [EV_HEADER,
           ["EV-1", "2026/10/10", "20260916-01", "AI関係性", "SUPPORT", "FDA", "https://fda.gov/x"],
           ["EV-2", "2026/10/11", "20260916-01", "AI × 医療", "EXPAND", "NIH", "https://nih.gov/y"],
           ["EV-3", "2026/10/11", "20260917-01", "医療AI", "COUNTER", "WHO", "https://who.int/z"]]
    evs += list(extra_ev_rows)
    make_xlsx(path, {"提案の種DB": (seeds, {}), "Seed Evidence Log": (evs, {})})


class CommonTest(unittest.TestCase):
    def test_redact_hides_secrets(self):
        s = common.redact("api_key=abc123 token: zzz sk-ABCDEFGHIJKLMNOPQRSTUV")
        self.assertNotIn("abc123", s)
        self.assertNotIn("zzz", s)
        self.assertNotIn("sk-ABCDEFGHIJ", s)

    def test_log_event_writes_jsonl_without_secret(self):
        e = common.log_event("unit", "ok", "password=hunter2", note="token=xyz")
        path = os.path.join(os.environ["AIO_LOG_DIR"], "unit.jsonl")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        self.assertNotIn("hunter2", text)
        self.assertNotIn("xyz", text)
        self.assertEqual(e["status"], "ok")

    def test_lock_prevents_double_run(self):
        with common.single_run_lock("unit_lock"):
            with self.assertRaises(common.LockBusy):
                with common.single_run_lock("unit_lock"):
                    pass
        with common.single_run_lock("unit_lock"):
            pass  # 解放後は取れる

    def test_retry_is_bounded(self):
        calls = []

        def boom():
            calls.append(1)
            raise OSError("x")
        with self.assertRaises(OSError):
            common.retry(boom, attempts=3, wait_sec=0)
        self.assertEqual(len(calls), 3)
        with self.assertRaises(ValueError):
            common.retry(boom, attempts=50)


class SnsExtractTest(unittest.TestCase):
    def setUp(self):
        self.state = {"used": {}}

    def test_extracts_tagged_notes_with_dedupe_and_excludes(self):
        found, skipped = ec.extract(VAULT, state=self.state, excludes=ec.load_excludes(os.devnull) + ["業務記録/*"])
        notes = sorted(c["note"] for c in found)
        self.assertIn("Daily/2026-10-02.md", notes)       # フロントマターのタグ
        self.assertNotIn("Daily/2026-10-04.md", notes)    # #発信候補メモ は別タグ
        self.assertFalse(any(n.startswith("業務記録/") for n in notes))  # 業務記録は除外
        titles = [c["title"] for c in found]
        self.assertEqual(titles.count("聴く力の話"), 1)   # 同じタイトルは1本に
        self.assertEqual(skipped["duplicate_in_batch"], 1)

    def test_privacy_flag(self):
        found, _ = ec.extract(VAULT, state=self.state, excludes=["業務記録/*"])
        flagged = {c["note"]: c["privacy_review_needed"] for c in found}
        self.assertTrue(flagged["Daily/2026-10-05.md"])
        self.assertFalse(flagged["Daily/2026-10-02.md"])

    def test_used_notes_are_skipped_next_time(self):
        found, _ = ec.extract(VAULT, state=self.state, excludes=["業務記録/*"])
        state = {"used": {c["hash"]: {"title": c["title"]} for c in found}}
        again, skipped = ec.extract(VAULT, state=state, excludes=["業務記録/*"])
        self.assertEqual(again, [])  # 同じ内容・同じタイトルの別メモも使用済み扱い
        self.assertEqual(skipped["used_before"], len(found) + 1)

    def test_mark_used_roundtrip(self):
        tmp = tempfile.mkdtemp()
        out, st = os.path.join(tmp, "c.json"), os.path.join(tmp, "state.json")
        self.assertEqual(ec.main(["--vault", VAULT, "--out", out, "--state", st]), 0)
        self.assertEqual(ec.main(["--mark-used", out, "--state", st]), 0)
        with open(st, encoding="utf-8") as f:
            self.assertTrue(json.load(f)["used"])

    def test_rejects_non_vault(self):
        with self.assertRaises(FileNotFoundError):
            ec.extract(HERE, state=self.state)


def _draft(days=7, drop=None, empty_li_url=False):
    wd = "月火水木金土日"
    parts = ["ステータス：確認待ち（人の目で確認後に投稿）", ""]
    for i in range(days):
        parts.append("10/%d（%s）｜テーマ%d" % (5 + i, wd[i % 7], i))
        for p in vw.PLATFORMS:
            if drop and drop == (i, p):
                continue
            body = "本文%s" % p
            if p == "LinkedIn" and not empty_li_url:
                body += "\n参考：https://www.mhlw.go.jp/"
            parts += ["【%s】" % p, body, ""]
        parts.append("画像案：図\nCTA：問い\n")
    return "\n".join(parts)


class WeeklyDraftTest(unittest.TestCase):
    def test_empty_doc_is_unusable(self):
        r = vw.validate("")
        self.assertEqual(r["level"], 2)

    def test_complete_draft_passes(self):
        r = vw.validate(_draft())
        self.assertEqual(r["level"], 0, r)
        self.assertEqual(r["days"], 7)

    def test_missing_platform_and_days(self):
        r = vw.validate(_draft(days=5, drop=(2, "X")))
        self.assertEqual(r["level"], 2)
        self.assertTrue(any("日数" in e for e in r["errors"]))
        self.assertTrue(any("X" in e for e in r["errors"]))

    def test_linkedin_without_source_warns(self):
        r = vw.validate(_draft(empty_li_url=True))
        self.assertEqual(r["level"], 1)


class SeedDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "db.xlsx")

    def test_detects_known_problems(self):
        seed_workbook(self.path)
        r = seed_db.check(self.path, today=dt.date(2026, 10, 12))
        msgs = " ".join(i["message"] for i in r["issues"])
        self.assertIn("4行目が空行", msgs)
        self.assertIn("サンプル", msgs)
        self.assertIn("最終Evidence日", msgs)
        self.assertIn("別々のSeed名", msgs)
        self.assertEqual(r["summary"]["latest_evidence_date"], "2026-10-11")
        self.assertEqual(r["summary"]["evidence"], 3)

    def test_healthy_last_date_column_passes(self):
        seed_workbook(self.path, last_dates=("2026/10/11", "2026/10/11"))
        r = seed_db.check(self.path, today=dt.date(2026, 10, 12))
        self.assertFalse(any("最終Evidence日" in i["message"] for i in r["issues"]))

    def test_stale_and_orphan_and_duplicates(self):
        seed_workbook(self.path,
                      extra_seed_rows=[["20260916-01", "2026/09/18", "重複", "x", "https://who.int/news/a", "Seed", "Z", None]],
                      extra_ev_rows=[["EV-1", "2026/10/01", "NOPE", "x", "MAYBE", "x", "https://a.jp"]])
        r = seed_db.check(self.path, today=dt.date(2026, 10, 20))
        msgs = " ".join(i["message"] for i in r["issues"])
        self.assertIn("ID 20260916-01 が重複", msgs)
        self.assertIn("同じ情報源URLが重複", msgs)     # utm付き・www有無の違いを同一視
        self.assertIn("優先度が規定外", msgs)
        self.assertIn("Evidence ID EV-1 が重複", msgs)
        self.assertIn("存在しません", msgs)
        self.assertIn("自動処理が止まっている", msgs)

    def test_dedupe_before_insert(self):
        seed_workbook(self.path)
        cands = [
            {"kind": "seed", "url": "http://who.int/news/a/"},                       # 既存と同じ
            {"kind": "seed", "url": "https://example.org/new"},                      # 新規
            {"kind": "seed", "url": "https://example.org/new?utm_medium=mail"},      # 今回内で重複
            {"kind": "evidence", "seed_id": "20260916-01", "url": "https://fda.gov/x"},  # 既存証拠
            {"kind": "evidence", "seed_id": "20260917-01", "url": "https://fda.gov/x"},  # 別Seedなら新規
            {"kind": "seed", "url": ""},                                             # 出典なし
        ]
        new, skipped = seed_db.dedupe(self.path, cands)
        self.assertEqual(len(new), 2)
        self.assertEqual(len(skipped), 4)

    def test_normalize_url(self):
        a = seed_db.normalize_url("http://WWW.Example.com/a/?utm_source=x&id=3")
        b = seed_db.normalize_url("https://example.com/a?id=3")
        self.assertEqual(a, b)


class RouterTest(unittest.TestCase):
    def test_proposal_request(self):
        r = route.route("健康経営に関する企業提案書を作りたい")
        self.assertEqual(r["category"]["id"], "B")
        self.assertEqual(r["autonomy"], "L1")

    def test_sns_not_double_downgraded(self):
        r = route.route("来週のLinkedIn投稿を作って")
        self.assertEqual((r["category"]["id"], r["autonomy"]), ("D", "L1"))

    def test_research_is_full_auto(self):
        r = route.route("THP指針改正の一次情報を調べて")
        self.assertEqual((r["category"]["id"], r["autonomy"]), ("E", "L3"))

    def test_single_letter_keyword_is_word_bounded(self):
        r = route.route("Excelの集計を見たい")
        self.assertEqual(r["decision"], "要確認")

    def test_umbrella_category_wins_tie(self):
        r = route.route("研修スライドを作り、根拠も集めたい")
        self.assertEqual((r["decision"], r["category"]["id"]), ("提案", "A"))

    def test_health_info_adds_approval_and_downgrades(self):
        r = route.route("ストレスチェック結果を集計するスクリプトを作りたい")
        self.assertEqual(r["autonomy"], "L1")
        self.assertTrue(any("個人・健康情報" in a for a in r["approvals"]))

    def test_system_names_do_not_trigger_categories(self):
        # 2026-10-12 実運用で発見：「提案の種DB」の「提案」で区分B（提案書）に誤判定していた
        r = route.route("提案の種DBのデータ品質を調べて、問題点を整理して")
        self.assertEqual((r["decision"], r["category"]["id"], r["autonomy"]), ("提案", "H", "L3"))

    def test_handoff_lifecycle(self):
        shared = tempfile.mkdtemp()
        r = route.route("THP指針改正の一次情報を調べて")
        p = route.write_handoff(r, shared=shared)
        self.assertTrue(p.startswith(os.path.join(shared, "inbox")))
        p = route.move_handoff(p, "working", shared=shared)
        p = route.move_handoff(p, "completed", "検証済み", shared=shared)
        with open(p, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("- 状態：completed", text)
        self.assertIn("completed へ移動：検証済み", text)
        self.assertFalse(os.listdir(os.path.join(shared, "inbox")))


@unittest.skipUnless(shutil.which("rsync") and shutil.which("bash"), "rsync が無い環境")
class SyncScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.vault = os.path.join(self.tmp, "Second Brain")
        self.drive_root = os.path.join(self.tmp, "GoogleDrive", "マイドライブ")
        self.dest = os.path.join(self.drive_root, "Second Brain")
        os.makedirs(os.path.join(self.vault, ".obsidian"))
        os.makedirs(os.path.join(self.vault, "業務記録"))
        os.makedirs(self.dest)
        for rel, text in [("a.md", "A"), ("sub/b.md", "B"), ("業務記録/c.md", "secret"), (".obsidian/workspace.json", "{}")]:
            p = os.path.join(self.vault, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
        self.logs = os.path.join(self.tmp, "logs")
        self.conf = os.path.join(self.tmp, "local.env")
        self.write_conf()

    def write_conf(self, **kw):
        conf = {"VAULT_PATH": self.vault, "DRIVE_DEST": self.dest, "PRIMARY_HOST": "",
                "OPEN_OBSIDIAN_BEFORE_SYNC": "0", "MIRROR_DELETE": "0"}
        conf.update(kw)
        with open(self.conf, "w", encoding="utf-8") as f:
            for k, v in conf.items():
                f.write('%s="%s"\n' % (k, v))

    def run_sync(self, *args):
        env = dict(os.environ, AIO_CONFIG=self.conf, AIO_LOG_DIR=self.logs)
        return subprocess.run(["bash", SYNC] + list(args), env=env, capture_output=True, text=True)

    def test_dry_run_changes_nothing(self):
        r = self.run_sync()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(os.listdir(self.dest), [])
        self.assertIn("試運転完了", r.stdout)

    def test_apply_copies_and_writes_status(self):
        r = self.run_sync("--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.exists(os.path.join(self.dest, "sub", "b.md")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, ".obsidian", "workspace.json")))
        with open(os.path.join(self.dest, "_SYNC_STATUS.md"), encoding="utf-8") as f:
            status = f.read()
        self.assertIn("verify_mismatch: 0", status)
        # 2回目も壊れない（冪等）
        self.assertEqual(self.run_sync("--apply").returncode, 0)

    def test_no_delete_by_default(self):
        self.run_sync("--apply")
        os.remove(os.path.join(self.vault, "a.md"))
        self.run_sync("--apply")
        self.assertTrue(os.path.exists(os.path.join(self.dest, "a.md")))

    def test_mirror_delete_keeps_backup(self):
        self.write_conf(MIRROR_DELETE="1")
        self.run_sync("--apply")
        os.remove(os.path.join(self.vault, "a.md"))
        r = self.run_sync("--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "a.md")))
        backups = os.listdir(os.path.join(self.dest, "_sync_backup"))
        self.assertTrue(any(os.path.exists(os.path.join(self.dest, "_sync_backup", b, "a.md")) for b in backups))

    def test_refuses_without_vault_or_drive(self):
        self.write_conf(VAULT_PATH=os.path.join(self.tmp, "nope"))
        self.assertEqual(self.run_sync("--apply").returncode, 3)
        self.write_conf(DRIVE_DEST=os.path.join(self.tmp, "nodrive", "x"))
        self.assertEqual(self.run_sync("--apply").returncode, 4)

    def test_refuses_dest_inside_vault(self):
        inside = os.path.join(self.vault, "copy")
        os.makedirs(inside)
        self.write_conf(DRIVE_DEST=inside)
        self.assertEqual(self.run_sync("--apply").returncode, 5)

    def test_secondary_mac_skips_when_primary_is_fresh(self):
        self.run_sync("--apply")
        self.write_conf(PRIMARY_HOST="別のMac")
        r = self.run_sync("--apply")
        self.assertEqual(r.returncode, 0)
        self.assertIn("スキップ", r.stdout)

    def test_log_is_jsonl(self):
        self.run_sync("--apply")
        with open(os.path.join(self.logs, "obsidian_sync.jsonl"), encoding="utf-8") as f:
            lines = [json.loads(x) for x in f if x.strip()]
        self.assertEqual(lines[-1]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
