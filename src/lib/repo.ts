import { getDb } from "@/lib/db";
import { shortId, secretToken, uuid } from "@/lib/ids";
import type {
  Account,
  Answer,
  Participant,
  Poll,
  PollBundle,
  ShareChannel,
  ShareTarget,
  Slot,
  SlotTally,
  Vote,
} from "@/lib/types";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));

/* ---------------------------------------------------------------- accounts */

function mapAccount(r: Row): Account {
  return {
    id: str(r.id),
    googleSub: str(r.google_sub),
    email: str(r.email),
    name: str(r.name),
    picture: strOrNull(r.picture),
    accessToken: strOrNull(r.access_token),
    refreshToken: strOrNull(r.refresh_token),
    expiresAt: num(r.expires_at),
    scope: str(r.scope),
  };
}

export function upsertAccount(input: {
  googleSub: string;
  email: string;
  name: string;
  picture: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}): Account {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare("SELECT * FROM accounts WHERE google_sub = ?")
    .get(input.googleSub) as Row | undefined;

  if (existing) {
    db.prepare(
      `UPDATE accounts
          SET email = ?, name = ?, picture = ?, access_token = ?,
              refresh_token = COALESCE(?, refresh_token),
              expires_at = ?, scope = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      input.email,
      input.name,
      input.picture,
      input.accessToken,
      input.refreshToken,
      input.expiresAt,
      input.scope,
      now,
      str(existing.id),
    );
    return getAccount(str(existing.id))!;
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO accounts
       (id, google_sub, email, name, picture, access_token, refresh_token,
        expires_at, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.googleSub,
    input.email,
    input.name,
    input.picture,
    input.accessToken,
    input.refreshToken,
    input.expiresAt,
    input.scope,
    now,
    now,
  );
  return getAccount(id)!;
}

export function getAccount(id: string): Account | null {
  const r = getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Row | undefined;
  return r ? mapAccount(r) : null;
}

export function updateAccountTokens(
  id: string,
  accessToken: string,
  expiresAt: number,
  refreshToken?: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE accounts
          SET access_token = ?, expires_at = ?,
              refresh_token = COALESCE(?, refresh_token), updated_at = ?
        WHERE id = ?`,
    )
    .run(accessToken, expiresAt, refreshToken ?? null, Date.now(), id);
}

export function disconnectAccount(id: string): void {
  getDb()
    .prepare(
      "UPDATE accounts SET access_token = NULL, refresh_token = NULL, expires_at = 0 WHERE id = ?",
    )
    .run(id);
}

/* ---------------------------------------------------------------- sessions */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(accountId: string): string {
  const id = secretToken();
  const now = Date.now();
  getDb()
    .prepare("INSERT INTO sessions (id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(id, accountId, now, now + SESSION_TTL_MS);
  return id;
}

export function getSessionAccount(sessionId: string): Account | null {
  const r = getDb()
    .prepare(
      `SELECT a.* FROM sessions s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, Date.now()) as Row | undefined;
  return r ? mapAccount(r) : null;
}

export function deleteSession(sessionId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

/* ------------------------------------------------------------------- polls */

function mapPoll(r: Row): Poll {
  return {
    id: str(r.id),
    adminToken: str(r.admin_token),
    accountId: strOrNull(r.account_id),
    title: str(r.title),
    description: str(r.description),
    organizerName: str(r.organizer_name),
    organizerEmail: strOrNull(r.organizer_email),
    timezone: str(r.timezone),
    durationMinutes: num(r.duration_minutes),
    locationMode: str(r.location_mode) as Poll["locationMode"],
    onlineProvider: str(r.online_provider) as Poll["onlineProvider"],
    customMeetingUrl: strOrNull(r.custom_meeting_url),
    offlinePlace: strOrNull(r.offline_place),
    status: str(r.status) as Poll["status"],
    confirmedSlotId: strOrNull(r.confirmed_slot_id),
    googleEventId: strOrNull(r.google_event_id),
    googleEventLink: strOrNull(r.google_event_link),
    meetingUrl: strOrNull(r.meeting_url),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export interface CreatePollInput {
  accountId: string | null;
  title: string;
  description: string;
  organizerName: string;
  organizerEmail: string | null;
  timezone: string;
  durationMinutes: number;
  locationMode: Poll["locationMode"];
  onlineProvider: Poll["onlineProvider"];
  customMeetingUrl: string | null;
  offlinePlace: string | null;
  /** epoch ms の開始時刻の配列。終了時刻は durationMinutes から導出する。 */
  starts: number[];
}

export function createPoll(input: CreatePollInput): Poll {
  const db = getDb();
  const id = shortId(10);
  const adminToken = secretToken();
  const now = Date.now();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO polls
         (id, admin_token, account_id, title, description, organizer_name, organizer_email,
          timezone, duration_minutes, location_mode, online_provider, custom_meeting_url,
          offline_place, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(
      id,
      adminToken,
      input.accountId,
      input.title,
      input.description,
      input.organizerName,
      input.organizerEmail,
      input.timezone,
      input.durationMinutes,
      input.locationMode,
      input.onlineProvider,
      input.customMeetingUrl,
      input.offlinePlace,
      now,
      now,
    );

    const insertSlot = db.prepare(
      "INSERT INTO slots (id, poll_id, starts_at, ends_at, sort_order) VALUES (?, ?, ?, ?, ?)",
    );
    const sorted = [...new Set(input.starts)].sort((a, b) => a - b);
    sorted.forEach((startsAt, i) => {
      insertSlot.run(uuid(), id, startsAt, startsAt + input.durationMinutes * 60_000, i);
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return getPoll(id)!;
}

export function getPoll(id: string): Poll | null {
  const r = getDb().prepare("SELECT * FROM polls WHERE id = ?").get(id) as Row | undefined;
  return r ? mapPoll(r) : null;
}

export function listPollsByAccount(accountId: string): Poll[] {
  return (
    getDb()
      .prepare("SELECT * FROM polls WHERE account_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(accountId) as Row[]
  ).map(mapPoll);
}

export function getPollBundle(id: string): PollBundle | null {
  const poll = getPoll(id);
  if (!poll) return null;
  const db = getDb();
  const slots = (
    db.prepare("SELECT * FROM slots WHERE poll_id = ? ORDER BY sort_order").all(id) as Row[]
  ).map(
    (r): Slot => ({
      id: str(r.id),
      pollId: str(r.poll_id),
      startsAt: num(r.starts_at),
      endsAt: num(r.ends_at),
      sortOrder: num(r.sort_order),
    }),
  );
  const participants = (
    db
      .prepare("SELECT * FROM participants WHERE poll_id = ? ORDER BY created_at")
      .all(id) as Row[]
  ).map(mapParticipant);
  const votes = (
    db
      .prepare(
        `SELECT v.* FROM votes v
           JOIN participants p ON p.id = v.participant_id
          WHERE p.poll_id = ?`,
      )
      .all(id) as Row[]
  ).map(
    (r): Vote => ({
      participantId: str(r.participant_id),
      slotId: str(r.slot_id),
      answer: str(r.answer) as Answer,
    }),
  );
  return { poll, slots, participants, votes };
}

export function confirmPoll(
  pollId: string,
  slotId: string,
  meta: {
    googleEventId?: string | null;
    googleEventLink?: string | null;
    meetingUrl?: string | null;
  } = {},
): void {
  getDb()
    .prepare(
      `UPDATE polls
          SET status = 'confirmed', confirmed_slot_id = ?,
              google_event_id = COALESCE(?, google_event_id),
              google_event_link = COALESCE(?, google_event_link),
              meeting_url = COALESCE(?, meeting_url),
              updated_at = ?
        WHERE id = ?`,
    )
    .run(
      slotId,
      meta.googleEventId ?? null,
      meta.googleEventLink ?? null,
      meta.meetingUrl ?? null,
      Date.now(),
      pollId,
    );
}

export function reopenPoll(pollId: string): void {
  getDb()
    .prepare(
      `UPDATE polls
          SET status = 'open', confirmed_slot_id = NULL, google_event_id = NULL,
              google_event_link = NULL, meeting_url = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .run(Date.now(), pollId);
}

/* ------------------------------------------------------------ participants */

function mapParticipant(r: Row): Participant {
  return {
    id: str(r.id),
    pollId: str(r.poll_id),
    editToken: str(r.edit_token),
    name: str(r.name),
    comment: str(r.comment),
    email: strOrNull(r.email),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/**
 * 回答の登録／更新。participantId を渡すと更新、なければ新規作成。
 * 投票は「全スロット分をまとめて置き換える」方式（部分更新は扱わない）。
 */
export function saveResponse(input: {
  pollId: string;
  participantId?: string | null;
  editToken?: string | null;
  name: string;
  comment: string;
  email: string | null;
  answers: Record<string, Answer>;
}): Participant {
  const db = getDb();
  const now = Date.now();

  db.exec("BEGIN");
  try {
    let participantId = input.participantId ?? null;

    if (participantId) {
      const existing = db
        .prepare("SELECT * FROM participants WHERE id = ? AND poll_id = ?")
        .get(participantId, input.pollId) as Row | undefined;
      if (!existing) throw new Error("participant not found");
      if (str(existing.edit_token) !== (input.editToken ?? "")) {
        throw new Error("invalid edit token");
      }
      db.prepare(
        "UPDATE participants SET name = ?, comment = ?, email = ?, updated_at = ? WHERE id = ?",
      ).run(input.name, input.comment, input.email, now, participantId);
      db.prepare("DELETE FROM votes WHERE participant_id = ?").run(participantId);
    } else {
      participantId = uuid();
      db.prepare(
        `INSERT INTO participants (id, poll_id, edit_token, name, comment, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        participantId,
        input.pollId,
        secretToken(),
        input.name,
        input.comment,
        input.email,
        now,
        now,
      );
    }

    const validSlots = new Set(
      (db.prepare("SELECT id FROM slots WHERE poll_id = ?").all(input.pollId) as Row[]).map((r) =>
        str(r.id),
      ),
    );
    const insertVote = db.prepare(
      "INSERT INTO votes (participant_id, slot_id, answer) VALUES (?, ?, ?)",
    );
    for (const [slotId, answer] of Object.entries(input.answers)) {
      if (!validSlots.has(slotId)) continue;
      insertVote.run(participantId, slotId, answer);
    }
    db.exec("COMMIT");

    return mapParticipant(
      db.prepare("SELECT * FROM participants WHERE id = ?").get(participantId) as Row,
    );
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function deleteParticipant(pollId: string, participantId: string): void {
  getDb()
    .prepare("DELETE FROM participants WHERE id = ? AND poll_id = ?")
    .run(participantId, pollId);
}

/* ---------------------------------------------------------- share targets */

export function addShareTarget(input: {
  pollId: string;
  channel: ShareChannel;
  target: string;
  label: string;
}): ShareTarget {
  const id = uuid();
  getDb()
    .prepare(
      "INSERT INTO share_targets (id, poll_id, channel, target, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, input.pollId, input.channel, input.target, input.label, Date.now());
  return { id, pollId: input.pollId, channel: input.channel, target: input.target, label: input.label };
}

export function listShareTargets(pollId: string): ShareTarget[] {
  return (
    getDb()
      .prepare("SELECT * FROM share_targets WHERE poll_id = ? ORDER BY created_at")
      .all(pollId) as Row[]
  ).map((r) => ({
    id: str(r.id),
    pollId: str(r.poll_id),
    channel: str(r.channel) as ShareChannel,
    target: str(r.target),
    label: str(r.label),
  }));
}

export function deleteShareTarget(pollId: string, id: string): void {
  getDb().prepare("DELETE FROM share_targets WHERE id = ? AND poll_id = ?").run(id, pollId);
}

/* ------------------------------------------------------------------ tally */

/**
 * ○=2点 / △=1点 / ×=0点。スコア降順 → ○の数降順 → 開始時刻昇順。
 * 「×が1つでもあれば除外」といった強い規則は入れていない。
 * 主催者が事情を見て判断できるよう、順位付けは提案にとどめる。
 */
export function tally(bundle: PollBundle): SlotTally[] {
  const byslot = new Map<string, SlotTally>();
  for (const slot of bundle.slots) {
    byslot.set(slot.id, { slot, yes: 0, maybe: 0, no: 0, score: 0 });
  }
  for (const v of bundle.votes) {
    const t = byslot.get(v.slotId);
    if (!t) continue;
    if (v.answer === "yes") {
      t.yes += 1;
      t.score += 2;
    } else if (v.answer === "maybe") {
      t.maybe += 1;
      t.score += 1;
    } else {
      t.no += 1;
    }
  }
  return [...byslot.values()].sort(
    (a, b) => b.score - a.score || b.yes - a.yes || a.slot.startsAt - b.slot.startsAt,
  );
}
