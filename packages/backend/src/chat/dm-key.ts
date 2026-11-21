/**
 * The identity of a DM: its workspace plus its member set. Stored in the
 * unique `ChatChannel.dmKey`, which is what makes opening a DM with the same
 * people return the same channel — including when two of them open it at the
 * same moment, since the loser of that race hits the unique index.
 *
 * Ids are deduplicated and sorted numerically so the key depends on the set,
 * never on the order the caller listed it in.
 */
export function dmKey(workspaceId: string, userIds: number[]): string {
  const ids = [...new Set(userIds)].sort((a, b) => a - b);
  return `${workspaceId}:${ids.join(',')}`;
}
