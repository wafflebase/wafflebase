import type { ChatMessageDto } from "@/api/chat";
import { parseMentionBody } from "@/components/comments/mentions";

import { routerBasename } from "./document-link";

/** Whether a body mentions user `me`. */
export function mentionsUser(body: string, me: number): boolean {
  return parseMentionBody(body).some(
    (s) => s.type === "mention" && s.userId === String(me),
  );
}

/**
 * The link a message's "Copy link" puts on the clipboard: the same
 * `?message=` deep link the notification bell opens, which scrolls to the
 * message and opens its thread when it is a reply.
 */
export function messageLink(
  workspaceId: string,
  message: Pick<ChatMessageDto, "id" | "channelId">,
): string {
  return `${window.location.origin}${routerBasename()}/w/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(message.channelId)}?message=${encodeURIComponent(message.id)}`;
}
