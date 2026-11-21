/**
 * Shared chat contracts. The REST DTOs here are mirrored by the frontend
 * (`packages/frontend/src/api/chat.ts`); `seq` travels as a JSON `number`
 * although Postgres stores it as a `BigInt`. See `docs/design/chat.md`.
 */

export type ChannelKind = 'public' | 'private' | 'dm';

export interface ChatUserSummary {
  id: number;
  username: string;
  photo: string | null;
}

export interface ChannelSummary {
  id: string;
  kind: ChannelKind;
  /** Null for a DM, which is labelled by its members. */
  name: string | null;
  topic: string | null;
  archived: boolean;
  isMember: boolean;
  /** DM only; empty for public and private channels. */
  members: ChatUserSummary[];
  unreadCount: number;
  mentionCount: number;
  lastMessageAt: string | null;
}

export interface ChatMessageDto {
  id: string;
  channelId: string;
  seq: number;
  /** Null once the author's account is deleted. */
  author: ChatUserSummary | null;
  /** Empty when `deleted`. */
  body: string;
  threadRootId: string | null;
  alsoInChannel: boolean;
  replyCount: number;
  lastReplyAt: string | null;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
}

/**
 * What crosses replicas on the `chat` NOTIFY channel. Ids only — never
 * message content — and short keys, since a NOTIFY payload is capped at 8 kB.
 * `msg`: channel, workspace, seq, thread root, author. `mem`: a channel's
 * membership changed, so cached member sets for it are stale.
 */
export type ChatBusEvent =
  | {
      t: 'msg';
      c: string;
      w: string;
      s: number;
      r: string | null;
      a: number | null;
    }
  | { t: 'mem'; c: string };

/** The `message` event of `GET /chat/stream`. Carries no body. */
export interface StreamMessageEvent {
  workspaceId: string;
  channelId: string;
  seq: number;
  threadRootId: string | null;
  authorId: number | null;
}
