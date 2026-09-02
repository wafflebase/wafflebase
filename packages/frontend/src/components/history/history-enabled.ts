/**
 * Whether to offer version history. Off by default: until Yorkie gates the
 * revision RPCs behind the auth webhook, any attached client can restore, so
 * the feature ships dark. Viewers never see it — Google Docs does not show
 * version history to viewers either.
 */
export function isHistoryEnabled(
  env: { VITE_WB_REVISION_HISTORY?: string },
  role: 'viewer' | 'editor' | 'member',
): boolean {
  if (env.VITE_WB_REVISION_HISTORY !== 'true') return false;
  return role !== 'viewer';
}
