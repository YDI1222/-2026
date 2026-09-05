/** 環境変数の読み取りを 1 か所に集める（未設定時の挙動を明示するため）。 */

export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

/** Google 連携が使える状態か。未設定でも「Google なしの調整さん」として動く。 */
export const googleEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

export const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
/** LINE 公式アカウントからの push 送信が使える状態か。 */
export const lineEnabled = Boolean(LINE_CHANNEL_ACCESS_TOKEN);

export const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE ?? "Asia/Tokyo";
