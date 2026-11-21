import { Prisma } from '@prisma/client';

/** The name a workspace's default channel starts with. It may be renamed. */
export const DEFAULT_CHANNEL_NAME = 'general';

/**
 * Creates the workspace's default channel (#general) with its owner as the
 * only member. Runs inside the transaction that creates the workspace, so a
 * workspace never exists without one. Raw Prisma rather than
 * `ChatChannelService`, which would make the workspace and user modules
 * depend on the chat module; this file is the one author of the shape.
 */
export async function createDefaultChannel(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  ownerId: number,
): Promise<void> {
  await tx.chatChannel.create({
    data: {
      workspaceId,
      kind: 'public',
      name: DEFAULT_CHANNEL_NAME,
      createdBy: ownerId,
      defaultKey: workspaceId,
      members: { create: { userId: ownerId } },
    },
  });
}

/**
 * Adds a new workspace member to the default channel, reading from the tail
 * like any other join: history from before they arrived is not unread.
 * Returns the channel id so the caller can announce the membership change
 * after commit, or null when the workspace has no default channel (a
 * workspace whose `general` was private before defaults existed).
 */
export async function joinDefaultChannel(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: number,
): Promise<string | null> {
  const channel = await tx.chatChannel.findUnique({
    where: { defaultKey: workspaceId },
    select: { id: true, lastSeq: true },
  });
  if (!channel) return null;
  await tx.chatChannelMember.createMany({
    data: [{ channelId: channel.id, userId, lastReadSeq: channel.lastSeq }],
    skipDuplicates: true,
  });
  return channel.id;
}
