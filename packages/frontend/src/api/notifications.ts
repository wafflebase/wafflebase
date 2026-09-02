import type { DocumentType } from "@/types/documents";
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

/**
 * The comment events a *client* may report. Its own union, not a subtraction
 * from `NotificationType`: the report endpoint accepts exactly these, and
 * deriving it with `Exclude` meant every server-created type added later
 * silently widened what a client was allowed to claim happened.
 */
export type CommentNotificationType =
  | "comment_mention"
  | "comment_reply"
  | "thread_resolved";

export type NotificationType =
  | CommentNotificationType
  | "workspace_member_joined"
  // Created server-side when a reviewer decides a template submission. The
  // decision is the type, so the dropdown can render one sentence per outcome.
  | "template_approved"
  | "template_rejected"
  | "template_removed";

export interface Notification {
  id: string;
  type: NotificationType;
  /** Null once the acting user is deleted. */
  actor: { id: number; username: string; photo: string | null } | null;
  /** Null for workspace-level notifications. */
  document: { id: string; title: string; type: DocumentType } | null;
  threadId: string | null;
  commentId: string | null;
  preview: string | null;
  readAt: string | null;
  createdAt: string;
}

/** What the client reports after writing a comment to the CRDT. */
export interface CommentNotificationInput {
  type: CommentNotificationType;
  documentId: string;
  threadId: string;
  commentId?: string;
  recipientUserIds: number[];
  preview: string;
}

const base = () => `${import.meta.env.VITE_BACKEND_API_URL}/notifications`;

/** Most recent notifications, newest first. `before` pages backwards. */
export async function fetchNotifications(
  before?: string,
): Promise<Notification[]> {
  const url = new URL(base());
  if (before) url.searchParams.set("before", before);
  const response = await fetchWithAuth(url.toString());
  await assertOk(response, "Failed to fetch notifications");
  return response.json();
}

export async function fetchUnreadCount(): Promise<number> {
  const response = await fetchWithAuth(`${base()}/unread-count`);
  await assertOk(response, "Failed to fetch unread count");
  const body: { count: number } = await response.json();
  return body.count;
}

/** Omit `ids` to mark everything read. */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const response = await fetchWithAuth(`${base()}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  await assertOk(response, "Failed to mark notifications read");
}

/**
 * Tell the backend a comment event happened. Comments live in Yorkie, so the
 * server cannot see them; it authorizes this report rather than trusting it.
 */
export async function reportCommentNotification(
  input: CommentNotificationInput,
): Promise<void> {
  const response = await fetchWithAuth(`${base()}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await assertOk(response, "Failed to report comment notification");
}
