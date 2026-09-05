/**
 * 作成 → 回答 → 集計 → 確定 → 共有 までを実際のブラウザで通す確認スクリプト。
 * Google 連携なしで動く範囲を対象にしている（カレンダー登録は手動確認）。
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run build && npm start        # 別のターミナルで
 *   npm run test:e2e
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const log = (...a) => console.log("·", ...a);
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log("✗", msg); } else console.log("✓", msg); };

const browser = await chromium.launch({
  // 環境によっては実行ファイルの場所を指定する必要がある。
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CI ? ["--no-sandbox"] : [],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
page.on("pageerror", (e) => { failures++; console.log("✗ pageerror:", e.message); });

// ---- 1. 作成 ----
await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
await page.fill('input[name="title"]', "新サービスの打ち合わせ");
await page.fill('textarea[name="description"]', "30分ほど、資料共有あり");
await page.fill('input[name="organizerName"]', "山田");
await page.selectOption('select[name="durationMinutes"]', "30");

// 候補を3つ手で追加
const base = new Date(Date.now() + 3 * 86400000);
const pad = (n) => String(n).padStart(2, "0");
const day = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
for (const t of ["10:00", "14:00", "16:30"]) {
  await page.fill('input[type="datetime-local"]', `${day}T${t}`);
  await page.getByRole("button", { name: "追加" }).click();
}
const chips = await page.locator("li:has(button[aria-label*='削除'])").count();
check(chips === 3, `候補が3件たまった (${chips})`);

await page.getByRole("button", { name: "調整ページをつくる" }).click();
await page.waitForURL(/\/p\/[^/]+\/manage/, { timeout: 15000 });
const manageUrl = page.url();
const pollId = manageUrl.match(/\/p\/([^/]+)\/manage/)[1];
log("poll:", pollId);
check(await page.getByText("主催者ページ").isVisible(), "主催者ページに遷移した");
check(await page.getByText("Google 未連携で作られたため").isVisible(), "未連携時の注意書きが出る");

// ---- 2. 参加者2人が回答 ----
const voteUrl = `${BASE}/p/${pollId}`;
for (const [name, answers, comment] of [
  ["佐藤", ["yes", "yes", "no"], "午前が助かります"],
  ["鈴木", ["no", "yes", "maybe"], ""],
]) {
  const p = await browser.newPage();
  await p.goto(voteUrl, { waitUntil: "networkidle" });
  await p.fill('input[name="name"]', name);
  if (comment) await p.fill('input[name="comment"]', comment);
  const rows = p.locator("form li:has(input[type=radio])");
  const n = await rows.count();
  check(n === 3, `${name}: 候補3行が出ている (${n})`);
  for (let i = 0; i < 3; i++) {
    await rows.nth(i).locator(`input[value="${answers[i]}"]`).click({ force: true });
  }
  await p.getByRole("button", { name: "回答する" }).click();
  await p.waitForURL(/\?me=/, { timeout: 15000 });
  check(await p.getByText(name, { exact: false }).first().isVisible(), `${name}: 回答が保存された`);
  await p.close();
}

// ---- 3. 集計の確認 ----
await page.goto(manageUrl, { waitUntil: "networkidle" });
const table = await page.locator("table").innerText();
log("集計表:\n" + table);
check(table.includes("佐藤") && table.includes("鈴木"), "集計表に2人が並ぶ");
// 14:00 は ○2 なので最上位になるはず
const firstRadioLabel = await page.locator('form li:has(input[name="slotId"])').first().innerText();
log("確定候補の先頭:", firstRadioLabel.replace(/\n/g, " "));
check(firstRadioLabel.includes("14:00"), "○が最多の 14:00 が先頭に並ぶ");
check(firstRadioLabel.includes("○2"), "14:00 の ○ が 2");

// ---- 4. 確定 ----
await page.getByRole("button", { name: "この日時で確定する" }).click();
await page.waitForURL(/confirmed=1/, { timeout: 15000 });
check(await page.getByText("確定しました").isVisible(), "確定できた");
const decision = await page.locator("pre").last().innerText();
log("確定文面:\n" + decision);
check(decision.includes("【日程が決まりました】"), "確定文面が生成される");
check(decision.includes("14:00〜14:30"), "確定文面に日時が入る（所要30分が反映）");
check(decision.includes("会議リンクは追ってお送りします"), "Meet未発行なら誤解を招く表記をしない");

// 共有リンクの中身
const lineHref = await page.locator('a:has-text("LINE で送る")').last().getAttribute("href");
check(lineHref.startsWith("https://line.me/R/share?text="), "LINE 共有リンクが正しい");
check(decodeURIComponent(lineHref).includes("新サービスの打ち合わせ"), "LINE リンクに文面が載る");

// ---- 5. 参加者ページで確定が見える ----
const p3 = await browser.newPage();
await p3.goto(voteUrl, { waitUntil: "networkidle" });
check(await p3.getByText("この日程で決まりました").isVisible(), "参加者ページに確定が出る");
const calHref = await p3.locator('a:has-text("Google カレンダーに追加")').first().getAttribute("href");
check(calHref.includes("calendar.google.com/calendar/render"), "手動でカレンダー追加できるリンクがある");
await p3.close();

// ---- 6. 主催者トークンなしでは管理画面に入れない ----
const p4 = await browser.newPage();
await p4.goto(`${BASE}/p/${pollId}/manage?t=wrong`, { waitUntil: "networkidle" });
check(await p4.getByText("主催者用のリンクが正しくありません").isVisible(), "誤ったトークンは拒否される");
await p4.close();

// ---- 7. 確定の取り消し ----
await page.goto(manageUrl, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /確定を取り消す/ }).click();
await page.waitForTimeout(1500);
check(await page.getByRole("button", { name: "この日時で確定する" }).isVisible(), "確定を取り消せる");

await browser.close();
console.log(failures === 0 ? "\n=== ALL PASS ===" : `\n=== ${failures} FAILURE(S) ===`);
process.exit(failures === 0 ? 0 : 1);
