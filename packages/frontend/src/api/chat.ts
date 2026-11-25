import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import { seg } from "./url";

/*
 * Workspace chat client. The types mirror `packages/backend/src/chat/
 * chat.types.ts`; `seq` arrives as a JSON `number` although Postgres stores it
 * as a `BigInt`. Design: docs/design/chat.md.
 */

export type ChannelKind = "public" | "private" | "dm";

export interface ChatUserSummary {
  id: number;
  username: string;
  photo: string | null;
}

/** A row of a public or private channel's member list. */
export interface ChannelMember extends ChatUserSummary {
  /**
   * Whether the caller may remove this person — the server's `canRemove`:
   * the channel's creator or a workspace owner, an owner only by an owner,
   * never yourself or anyone on the default channel.
   */
  canRemove: boolean;
}

export interface ChannelSummary {
  id: string;
  kind: ChannelKind;
  /** Null for a DM, which is labelled by its members. */
  name: string | null;
  topic: string | null;
  archived: boolean;
  /**
   * The workspace's default channel (#general): every member is in it, and
   * it cannot be left or archived. It can be renamed.
   */
  isDefault: boolean;
  isMember: boolean;
  /**
   * May this user rename, set the topic of, or archive it. The server's
   * `canManage`: a public channel's creator or a workspace owner, any member
   * of a private channel, nobody for a DM.
   */
  canManage: boolean;
  /** DM only; empty for public and private channels. */
  members: ChatUserSummary[];
  /** The channel's newest allocated `seq`, thread replies included. */
  lastSeq: number;
  /**
   * The newest `seq` the caller has read; null when they are not a member.
   * The "New messages" divider goes after it.
   */
  lastReadSeq: number | null;
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
  /**
   * Document cards: links in `body` naming a live document of this channel's
   * workspace, one per document; match by `documentId`. Absent on a message
   * this client has not had back from the server yet (an optimistic send).
   */
  refs?: ChatDocumentRefDto[];
}

/**
 * Where a card points inside its document (`docs/design/chat.md` § Document
 * Cards and Anchors). `label` is the sender's display snapshot, such as
 * `Sheet1!C3:E7`: axis and slide ids cannot be named without loading the
 * document.
 */
export type SheetAnchor = {
  tabId: string;
  rowId: string;
  colId: string;
  rowSpan: number;
  colSpan: number;
  label?: string;
};
export type DocAnchor = { blockId: string; excerpt?: string; label?: string };
export type SlidesAnchor = { slideId: string; label?: string };
export type ChatDocumentAnchor = SheetAnchor | DocAnchor | SlidesAnchor;

export interface ChatDocumentRefDto {
  documentId: string;
  /** The document's type (`sheet`, `doc`, `slides`, …), as a plain string. */
  type: string;
  title: string;
  anchor: ChatDocumentAnchor | null;
}

/** A row of a channel's Files list: a document at its latest share. */
export interface ChatFileDto extends ChatDocumentRefDto {
  messageId: string;
  /** Null once the sharer's account is deleted. */
  sharedBy: ChatUserSummary | null;
  sharedAt: string;
}

/** The `message` event of `GET /chat/stream`. Carries no body. */
export interface StreamMessageEvent {
  workspaceId: string;
  channelId: string;
  seq: number;
  threadRootId: string | null;
  authorId: number | null;
  /** A thread reply also sent to the channel; false for a top-level message. */
  alsoInChannel: boolean;
}

/**
 * The `update` event of `GET /chat/stream`: a message was edited or
 * deleted. Ids only; the client refetches the message.
 */
export interface StreamUpdateEvent {
  workspaceId: string;
  channelId: string;
  messageId: string;
  threadRootId: string | null;
}

/**
 * The `channel` event of `GET /chat/stream`: a channel's name, topic or
 * archive state changed. Ids only; the client refetches its channel list.
 */
export interface StreamChannelEvent {
  workspaceId: string;
  channelId: string;
}

/** One page of messages, as the server sizes it. */
export const CHAT_PAGE_SIZE = 50;
/** Longest body the server accepts. */
export const CHAT_BODY_MAX = 4000;

const api = () => import.meta.env.VITE_BACKEND_API_URL;
const chatBase = (workspaceId: string) =>
  `${api()}/workspaces/${seg(workspaceId)}/chat`;
const channelBase = (workspaceId: string, channelId: string) =>
  `${chatBase(workspaceId)}/channels/${seg(channelId)}`;

/** Where the browser opens the per-user event stream. */
export const chatStreamUrl = () => `${api()}/chat/stream`;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchChannels(
  workspaceId: string,
): Promise<ChannelSummary[]> {
  const res = await fetchWithAuth(`${chatBase(workspaceId)}/channels`);
  await assertOk(res, "Couldn't load channels");
  return res.json();
}

export async function createChannel(
  workspaceId: string,
  input: { kind: "public" | "private"; name: string; topic?: string },
): Promise<ChannelSummary> {
  const res = await fetchWithAuth(
    `${chatBase(workspaceId)}/channels`,
    json("POST", input),
  );
  await assertOk(res, "Couldn't create the channel");
  return res.json();
}

/**
 * Open (or reuse) the DM with exactly these people. The caller is added by
 * the server, so `userIds` names only the others.
 */
export async function openDm(
  workspaceId: string,
  userIds: number[],
): Promise<ChannelSummary> {
  const res = await fetchWithAuth(
    `${chatBase(workspaceId)}/channels`,
    json("POST", { kind: "dm", userIds }),
  );
  await assertOk(res, "Couldn't open the conversation");
  return res.json();
}

export async function joinChannel(
  workspaceId: string,
  channelId: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/members`,
    json("POST", {}),
  );
  await assertOk(res, "Couldn't join the channel");
}

/** Who is in a public or private channel. A DM's members are on its summary. */
export async function fetchChannelMembers(
  workspaceId: string,
  channelId: string,
): Promise<ChannelMember[]> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/members`,
  );
  await assertOk(res, "Couldn't load the channel's members");
  return res.json();
}

export async function inviteToChannel(
  workspaceId: string,
  channelId: string,
  userIds: number[],
): Promise<void> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/members`,
    json("POST", { userIds }),
  );
  await assertOk(res, "Couldn't add people to the channel");
}

export async function leaveChannel(
  workspaceId: string,
  channelId: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/members/me`,
    { method: "DELETE" },
  );
  await assertOk(res, "Couldn't leave the channel");
}

/**
 * Remove somebody else from a public or private channel — where the member
 * row's `canRemove` says so; leaving is `leaveChannel`.
 */
export async function removeChannelMember(
  workspaceId: string,
  channelId: string,
  userId: number,
): Promise<void> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/members/${userId}`,
    { method: "DELETE" },
  );
  await assertOk(res, "Couldn't remove them from the channel");
}

export async function updateChannel(
  workspaceId: string,
  channelId: string,
  patch: { name?: string; topic?: string; archived?: boolean },
): Promise<void> {
  const res = await fetchWithAuth(
    channelBase(workspaceId, channelId),
    json("PATCH", patch),
  );
  await assertOk(res, "Couldn't update the channel");
}

/**
 * One page (50) of messages in ascending `seq` order. Without `thread` it is
 * the channel's top level (plus replies also sent to the channel); with it,
 * that thread's replies.
 */
export async function fetchMessages(
  workspaceId: string,
  channelId: string,
  opts: { before?: number; after?: number; thread?: string } = {},
): Promise<ChatMessageDto[]> {
  const url = new URL(`${channelBase(workspaceId, channelId)}/messages`);
  if (opts.before !== undefined) {
    url.searchParams.set("before", String(opts.before));
  }
  if (opts.after !== undefined) {
    url.searchParams.set("after", String(opts.after));
  }
  if (opts.thread) url.searchParams.set("thread", opts.thread);
  const res = await fetchWithAuth(url.toString());
  await assertOk(res, "Couldn't load messages");
  return res.json();
}

/**
 * Post a message. `clientId` is the send's own id, the same on every retry,
 * so a retry whose first attempt reached the server gets that message back
 * instead of posting it twice.
 */
export async function postMessage(
  workspaceId: string,
  channelId: string,
  input: {
    body: string;
    threadRootId?: string;
    alsoInChannel?: boolean;
    clientId?: string;
  },
): Promise<ChatMessageDto> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/messages`,
    json("POST", input),
  );
  await assertOk(res, "Couldn't send the message", {
    statusMessages: {
      409: "This channel is archived, so it no longer takes messages.",
      429: "You're sending messages too quickly. Wait a moment and try again.",
    },
  });
  return res.json();
}

export async function editMessage(
  workspaceId: string,
  messageId: string,
  body: string,
): Promise<ChatMessageDto> {
  const res = await fetchWithAuth(
    `${chatBase(workspaceId)}/messages/${seg(messageId)}`,
    json("PATCH", { body }),
  );
  await assertOk(res, "Couldn't edit the message");
  return res.json();
}

export async function deleteMessage(
  workspaceId: string,
  messageId: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${chatBase(workspaceId)}/messages/${seg(messageId)}`,
    { method: "DELETE" },
  );
  await assertOk(res, "Couldn't delete the message");
}

/** Advance the caller's read position. The server never moves it backwards. */
export async function markRead(
  workspaceId: string,
  channelId: string,
  seq: number,
): Promise<void> {
  const res = await fetchWithAuth(
    `${channelBase(workspaceId, channelId)}/read`,
    json("POST", { seq }),
  );
  await assertOk(res, "Couldn't mark the channel read");
}

/**
 * One message by id, or null when the caller cannot see it. A deep link from
 * the bell names a message, and only this tells whether it is a thread reply
 * whose thread has to be opened.
 */
export async function fetchMessage(
  workspaceId: string,
  messageId: string,
): Promise<ChatMessageDto | null> {
  const res = await fetchWithAuth(
    `${chatBase(workspaceId)}/messages/${seg(messageId)}`,
  );
  if (res.status === 404) return null;
  await assertOk(res, "Couldn't load the message");
  return res.json();
}

/** A channel a document was shared in, at its latest share there. */
export interface ChatSharedIn {
  channelId: string;
  sharedAt: string;
}

/**
 * The channels `documentId` was shared in that the caller belongs to, most
 * recent first.
 */
export async function fetchDocumentSharedIn(
  workspaceId: string,
  documentId: string,
): Promise<ChatSharedIn[]> {
  const res = await fetchWithAuth(
    `${chatBase(workspaceId)}/documents/${seg(documentId)}/channels`,
  );
  await assertOk(res, "Couldn't load where this document was shared");
  const body: { channels: ChatSharedIn[] } = await res.json();
  return body.channels;
}

/**
 * A channel's Files: each document its messages link to, once, newest share
 * first. `cursor` is the `before` of the next page, null on the last.
 */
export async function fetchChannelFiles(
  workspaceId: string,
  channelId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<{ files: ChatFileDto[]; cursor: string | null }> {
  const url = new URL(`${channelBase(workspaceId, channelId)}/files`);
  if (opts.limit !== undefined) url.searchParams.set("limit", String(opts.limit));
  if (opts.before) url.searchParams.set("before", opts.before);
  const res = await fetchWithAuth(url.toString());
  await assertOk(res, "Couldn't load the channel's files");
  return res.json();
}
