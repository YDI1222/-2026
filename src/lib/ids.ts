import { randomBytes, randomUUID } from "node:crypto";

// 人が読み上げても誤りにくい文字集合（0/O, 1/I/l を除外）
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

/** URL に載せる短い公開 ID。衝突確率を下げたい場合は length を増やす。 */
export function shortId(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 推測されては困る秘密トークン（主催者用リンクなど）。 */
export function secretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function uuid(): string {
  return randomUUID();
}
