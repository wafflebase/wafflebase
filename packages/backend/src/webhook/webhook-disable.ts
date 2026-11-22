import { Prisma } from '@prisma/client';

/** `lastError` of a row a disable stopped before it was delivered. */
export const TURNED_OFF_ERROR = 'Webhook turned off';

/**
 * The half every disable shares — manual, `failing`, `gone` and
 * `creator_removed` alike: fail what the webhooks still have queued, so
 * turning one off and on again never flushes what piled up meanwhile, and
 * record on each the creation time of the oldest row it stopped as
 * `recoverFrom` (or `now`, when it stopped none). That is the default
 * "recover since" a re-enable offers, so the default re-sends exactly what
 * the disable cut off; `disabledAt` alone would miss every one of those rows,
 * since they were all created before it.
 *
 * Run it after the webhook row itself is disabled, in the same transaction
 * where there is one. `in_flight` rows count toward `recoverFrom` too: the
 * worker fails them with the same error when their send finishes on a
 * webhook that has been turned off.
 */
export async function stopQueuedDeliveries(
  db: Prisma.TransactionClient,
  webhookIds: readonly string[],
  now: Date,
): Promise<void> {
  if (webhookIds.length === 0) return;
  const at = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  await db.$executeRaw`
    UPDATE "Webhook" w
    SET "recoverFrom" = LEAST(${at}, (
      SELECT min(d."createdAt") FROM "WebhookDelivery" d
      WHERE d."webhookId" = w."id"
        AND d."status" IN ('pending', 'in_flight')
    ))
    WHERE w."id" IN (${Prisma.join([...webhookIds])})`;
  await db.webhookDelivery.updateMany({
    where: { webhookId: { in: [...webhookIds] }, status: 'pending' },
    data: { status: 'failed', lastError: TURNED_OFF_ERROR },
  });
}
