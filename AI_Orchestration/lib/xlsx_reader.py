"""Excel(.xlsx) を標準ライブラリだけで読む最小限の部品。

Google スプレッドシートの「ダウンロード > Microsoft Excel」で保存したファイルを想定。
値（数式の計算結果）と、数式そのものの両方を返す。追加インストール不要。
"""

import re
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _text(el):
    return "".join(t.text or "" for t in el.iter("{%s}t" % NS["m"]))


def read_workbook(path):
    """{シート名: {"values": [[...]], "formulas": {(行,列): "=..."}}} を返す（行・列は0始まり）。"""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = [_text(si) for si in root.findall("m:si", NS)]

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = {r.get("Id"): r.get("Target") for r in rels.iter(REL_NS + "Relationship")}

        sheets = {}
        for s in wb.find("m:sheets", NS):
            rid = s.get("{%s}id" % NS["r"])
            t = target[rid].lstrip("/")
            part = t if t.startswith("xl/") else "xl/" + t
            root = ET.fromstring(z.read(part))
            rows, formulas = [], {}
            for row in root.iter("{%s}row" % NS["m"]):
                r_idx = int(row.get("r")) - 1
                while len(rows) <= r_idx:
                    rows.append([])
                cells = rows[r_idx]
                for c in row.findall("m:c", NS):
                    ci = _col_index(c.get("r"))
                    while len(cells) <= ci:
                        cells.append(None)
                    f = c.find("m:f", NS)
                    if f is not None and f.text:
                        formulas[(r_idx, ci)] = "=" + f.text
                    v = c.find("m:v", NS)
                    typ = c.get("t")
                    if typ == "s" and v is not None:
                        val = shared[int(v.text)]
                    elif typ == "inlineStr":
                        val = _text(c)
                    elif v is not None:
                        val = v.text
                    else:
                        val = None
                    cells[ci] = val
            sheets[s.get("name")] = {"values": rows, "formulas": formulas}
        return sheets
