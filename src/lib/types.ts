export type LocationMode = "online" | "offline" | "hybrid";
export type OnlineProvider = "google_meet" | "custom" | "none";
export type PollStatus = "open" | "confirmed" | "cancelled";
export type Answer = "yes" | "maybe" | "no";
export type ShareChannel = "line" | "webhook";

export interface Account {
  id: string;
  googleSub: string;
  email: string;
  name: string;
  picture: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

export interface Poll {
  id: string;
  adminToken: string;
  accountId: string | null;
  title: string;
  description: string;
  organizerName: string;
  organizerEmail: string | null;
  timezone: string;
  durationMinutes: number;
  locationMode: LocationMode;
  onlineProvider: OnlineProvider;
  customMeetingUrl: string | null;
  offlinePlace: string | null;
  status: PollStatus;
  confirmedSlotId: string | null;
  googleEventId: string | null;
  googleEventLink: string | null;
  meetingUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Slot {
  id: string;
  pollId: string;
  startsAt: number;
  endsAt: number;
  sortOrder: number;
}

export interface Participant {
  id: string;
  pollId: string;
  editToken: string;
  name: string;
  comment: string;
  email: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Vote {
  participantId: string;
  slotId: string;
  answer: Answer;
}

export interface ShareTarget {
  id: string;
  pollId: string;
  channel: ShareChannel;
  target: string;
  label: string;
}

/** 投票ページ/集計ページが必要とする一式。 */
export interface PollBundle {
  poll: Poll;
  slots: Slot[];
  participants: Participant[];
  votes: Vote[];
}

export interface SlotTally {
  slot: Slot;
  yes: number;
  maybe: number;
  no: number;
  /** ○=2点 / △=1点 で並べ替えるためのスコア。同点は開始が早い順。 */
  score: number;
}
