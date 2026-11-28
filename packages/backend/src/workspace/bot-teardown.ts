import { Prisma } from '@prisma/client';
import type { WebhookEventService } from '../webhook/webhook-event.service';

/**
 * Notification types whose preview quotes workspace content — a chat
 * message or a document comment — and so must not outlive the recipient's
 * membership of that workspace (`WorkspaceService.removeMember`).
 */
export const WORKSPACE_CONTENT_NOTIFICATION_TYPES = [
  'chat_mention',
  'chat_thread_reply',
  'comment_mention',
  'comment_reply',
  'thread_resolved',
] as const;

/**
 * Removes bots from a workspace inside the caller's transaction: their
 * memberships, every key their hosts hold, unspent pairing codes, open
 * tasks (no host can claim them once the keys are revoked), chat rows and
 * bell rows, each with a `member.removed` event. The `User` rows stay so
 * their messages keep their names.
 *
 * The one implementation behind both `BotService.remove` (one bot) and
 * `WorkspaceService.removeMember` (an owner's bots leave with them), so a
 * key can never outlive a committed removal by either path.
 *
 * Returns how many memberships it removed (0 when a concurrent delete got
 * there first) and the channels the bots left, for the membership
 * announcement.
 */
export async function removeBotsInTx(
  tx: Prisma.TransactionClient,
  webhookEvents: Pick<WebhookEventService, 'emitMemberEvent'>,
  input: { workspaceId: string; botIds: number[]; actor: number },
): Promise<{ removed: number; channelIds: string[] }> {
  const { workspaceId, botIds, actor } = input;
  if (botIds.length === 0) return { removed: 0, channelIds: [] };

  const { count: removed } = await tx.workspaceMember.deleteMany({
    where: { workspaceId, userId: { in: botIds } },
  });
  if (removed === 0) return { removed, channelIds: [] };
  await tx.apiKey.updateMany({
    where: { workspaceId, createdBy: { in: botIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.botPairingCode.deleteMany({
    where: { botId: { in: botIds }, usedAt: null },
  });
  await tx.agentTask.updateMany({
    where: { botId: { in: botIds }, status: { in: ['queued', 'claimed'] } },
    data: { status: 'failed', finishedAt: new Date() },
  });
  const memberships = await tx.chatChannelMember.findMany({
    where: { userId: { in: botIds }, channel: { workspaceId } },
    select: { channelId: true },
  });
  const channelIds = [...new Set(memberships.map((m) => m.channelId))];
  await tx.chatChannelMember.deleteMany({
    where: { userId: { in: botIds }, channelId: { in: channelIds } },
  });
  await tx.notification.deleteMany({
    where: {
      recipientId: { in: botIds },
      workspaceId,
      type: { in: [...WORKSPACE_CONTENT_NOTIFICATION_TYPES] },
    },
  });
  for (const botId of botIds) {
    await webhookEvents.emitMemberEvent(tx, {
      type: 'member.removed',
      workspaceId,
      actor,
      userId: botId,
      role: 'member',
    });
  }
  return { removed, channelIds };
}
