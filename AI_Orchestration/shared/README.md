# shared ― AI同士の受け渡し場所

| フォルダ | 意味 | 誰が置くか |
|---|---|---|
| `inbox/` | 受付済み・未着手 | 受付係（`route.py --write`）または人間 |
| `working/` | 作業中 | 担当AI |
| `review/` | 人間の確認待ち | 担当AI |
| `completed/` | 完了（検証済み） | 確認した人またはAI |

- ここに置く実データは **Git に入りません**（`.gitignore` 済み）。個人・顧客情報を含みうるためです。
- 将来、ChatGPT や Gemini とも共有したい場合は、このフォルダを Google Drive 上の
  「AI_Orchestration/shared」に置き換えます（`ARCHITECTURE.md` 4章）。
- ChatGPT・Gemini など直接つながらないAIには、引き継ぎ票の本文をそのまま貼り付けて渡し、
  返ってきた結果を同じ票の「記録」に追記します（手動の受け渡し）。

## 引き継ぎ票の書式

`route.py` が作る Markdown です。最低限、次の項目をそろえます。

```
# 引き継ぎ票
- ID / 作成 / 状態（inbox|working|review|completed）
## 依頼
## 判定（区分・任せ方 L0〜L3・調整理由）
## 承認ポイント（人間）
## 作業の流れ（工程・担当AI・つなぎ方・状態）
## 入力（参照する資料の場所）
## 完成の条件
## 検証（誰が・何で確かめたか）
## 記録（日時つきの移動・作業の履歴）
```

実例：`docs/examples/handoff_seed_db_check.md`
