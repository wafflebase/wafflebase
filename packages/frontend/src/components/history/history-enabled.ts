/**
 * Whether to offer version history. Off by default, and turning it on is a
 * **deployment** decision rather than a wait on upstream: `ListRevisions`,
 * `GetRevision` and `RestoreRevision` are gateable today, but only once the
 * server has registered them on the Yorkie auth webhook *and* runs with
 * `YORKIE_AUTH_WEBHOOK_ENFORCE=true` (shadow mode logs the denial and allows
 * the request anyway). Until a deployment has done both, any attached client
 * can read every past snapshot and restore the document, so the feature
 * ships dark. `CreateRevision` is the one exception that does need an
 * upstream fix — Yorkie calls the webhook for it with `attributes: null`, so
 * registering it would deny everyone — which leaves "Name current version"
 * open to any attached client. See `docs/design/revision-history.md` §2 and
 * `packages/backend/README.md`.
 *
 * Viewers never see it, flag or no flag — Google Docs does not show version
 * history to viewers either, and `getRevision` returns snapshots of content
 * that may predate the share link.
 */
export function isHistoryEnabled(
  env: { VITE_WB_REVISION_HISTORY?: string },
  role: 'viewer' | 'editor' | 'member',
): boolean {
  if (env.VITE_WB_REVISION_HISTORY !== 'true') return false;
  return role !== 'viewer';
}
