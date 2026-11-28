import { useMemo } from "react";

import type { ChannelSummary, ChatUserSummary } from "@/api/chat";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import { useWorkspaceMembers } from "@/components/comments/use-workspace-members";
import { useChannelMembers } from "./use-chat";

const toMention = (u: ChatUserSummary): MentionMember => ({
  userId: String(u.id),
  username: u.username,
  photo: u.photo || undefined,
  kind: u.kind,
});

/**
 * Who the `@` autocomplete offers in a channel: the people who can read it.
 * A public channel is readable by the whole workspace; a private channel or
 * a DM only by its own members, and the server flattens a mention of anyone
 * else to plain text — so offering them would only produce a mention that
 * goes nowhere. A DM's members travel on its summary; a private channel's
 * are fetched. Until the channel is known, nobody is offered.
 */
export function useMentionableMembers(
  workspaceId: string,
  channel: ChannelSummary | undefined,
): MentionMember[] {
  const workspaceMembers = useWorkspaceMembers(workspaceId);
  const { data: channelMembers } = useChannelMembers(
    workspaceId,
    channel?.id ?? "",
    channel?.kind === "private",
  );
  return useMemo(() => {
    if (!channel) return [];
    if (channel.kind === "public") return workspaceMembers;
    if (channel.kind === "dm") return channel.members.map(toMention);
    return (channelMembers ?? []).map(toMention);
  }, [channel, workspaceMembers, channelMembers]);
}
