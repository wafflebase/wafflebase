import { useQuery } from "@tanstack/react-query";

import { fetchDocumentSharedIn, type ChannelSummary } from "@/api/chat";

import { chatKeys } from "./chat-cache";

/** A channel the user can talk in: one they belong to, not archived. */
const open = (c: ChannelSummary) => c.isMember && !c.archived;

/**
 * The channels the panel's switcher offers: the ones the user belongs to,
 * most recently active first. Archived channels are left out, as in the Chat
 * page's switcher. A channel that is being shown but would not be listed (a
 * public channel previewed from a link) is kept at the top so the switcher
 * still says where you are.
 */
export function panelChannels(
  channels: ChannelSummary[],
  currentId: string | null,
): ChannelSummary[] {
  const time = (c: ChannelSummary) =>
    c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0;
  const listed = channels.filter(open).sort((a, b) => time(b) - time(a));
  const current = channels.find((c) => c.id === currentId);
  return current && !listed.includes(current) ? [current, ...listed] : listed;
}

/**
 * Which channel the editor's chat panel shows, in the order chat.md gives:
 *
 * 1. the one asked for — `?chat=` from a document card, `open({ channelId })`
 *    or the switcher — while it is still in the channel list (a public
 *    channel the user has not joined is, and shows as a preview);
 * 2. the channel this document was most recently shared in, among the ones
 *    the user belongs to (`sharedIn`, from `useDocumentSharedChannelId`);
 * 3. the user's last opened channel, while they are still in it;
 * 4. the workspace's default channel, else the most recently active one.
 *
 * Null while there is nothing to show.
 */
export function pickPanelChannel({
  channels,
  requested,
  sharedIn,
  last,
}: {
  channels: ChannelSummary[];
  requested: string | null;
  sharedIn: string | null;
  last: string | null;
}): string | null {
  if (requested && channels.some((c) => c.id === requested)) return requested;
  for (const id of [sharedIn, last]) {
    if (id && channels.some((c) => c.id === id && open(c))) return id;
  }
  const fallback =
    channels.find((c) => c.isDefault && open(c)) ??
    panelChannels(channels, null)[0];
  return fallback?.id ?? null;
}

/**
 * The channel `documentId` was most recently shared in, among the ones the
 * user belongs to — rule 2 of `pickPanelChannel` — from the document's
 * `ChatDocumentRef`s. `undefined` while that is still being asked, so the
 * panel can wait rather than settle on a fallback and then jump (taking a
 * "Send to chat" draft into the wrong channel); null when there is none or
 * the question failed.
 *
 * Read once per document visit: a share made while the panel is open must
 * not move the conversation the user is looking at.
 */
export function useDocumentSharedChannelId(
  workspaceId: string,
  documentId: string,
): string | null | undefined {
  const { data, isError } = useQuery({
    queryKey: [...chatKeys.all, "shared-in", workspaceId, documentId],
    queryFn: () => fetchDocumentSharedIn(workspaceId, documentId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (isError) return null;
  if (data === undefined) return undefined;
  return data[0]?.channelId ?? null;
}
