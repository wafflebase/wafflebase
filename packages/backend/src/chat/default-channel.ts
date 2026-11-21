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

/**
 * Repairs a workspace that has no default channel — one created by a pod
 * still running the code from before defaults existed, during the rolling
 * deploy that ran the backfill. The same steps as the
 * `20261121150000_chat_default_channel` backfill, scoped to one workspace:
 * adopt a public `general` (unarchiving it), else create one owned by the
 * first owner, then join every member at the tail. A workspace whose
 * `general` is private is left without one, as the backfill leaves it.
 * Idempotent and race-safe: the inserts yield on conflict. Returns the
 * default channel's id, or null.
 */
export async function ensureDefaultChannel(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<string | null> {
  await tx.$executeRaw`
    UPDATE "ChatChannel"
    SET "defaultKey" = "workspaceId", "archivedAt" = NULL
    WHERE "workspaceId" = ${workspaceId}
      AND "kind" = 'public' AND "name" = ${DEFAULT_CHANNEL_NAME}
      AND NOT EXISTS (
        SELECT 1 FROM "ChatChannel" d WHERE d."defaultKey" = ${workspaceId}
      )`;
  await tx.$executeRaw`
    INSERT INTO "ChatChannel" ("id", "workspaceId", "kind", "name", "createdBy", "defaultKey")
    SELECT gen_random_uuid()::text, ${workspaceId}, 'public', ${DEFAULT_CHANNEL_NAME},
           (SELECT m."userId" FROM "WorkspaceMember" m
            WHERE m."workspaceId" = ${workspaceId} AND m."role" = 'owner'
            ORDER BY m."userId" LIMIT 1),
           ${workspaceId}
    WHERE NOT EXISTS (
      SELECT 1 FROM "ChatChannel" c
      WHERE c."workspaceId" = ${workspaceId}
        AND (c."name" = ${DEFAULT_CHANNEL_NAME} OR c."defaultKey" = ${workspaceId})
    )
    ON CONFLICT DO NOTHING`;
  const channel = await tx.chatChannel.findUnique({
    where: { defaultKey: workspaceId },
    select: { id: true },
  });
  if (!channel) return null;
  await tx.$executeRaw`
    INSERT INTO "ChatChannelMember" ("channelId", "userId", "lastReadSeq")
    SELECT c."id", m."userId", c."lastSeq"
    FROM "ChatChannel" c
    JOIN "WorkspaceMember" m ON m."workspaceId" = c."workspaceId"
    WHERE c."id" = ${channel.id}
    ON CONFLICT ("channelId", "userId") DO NOTHING`;
  return channel.id;
}
