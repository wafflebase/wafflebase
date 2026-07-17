/**
 * A document's "manager" — the workspace **owner** or the document's **author**
 * — is the tier allowed to delete or move a document and to mint/manage editor
 * share links (a plain member has `rw` on the content but not these
 * administrative actions). See docs/design/sharing.md and docs/design/backend.md.
 *
 * This is the single source of the predicate so the legacy delete/move gate,
 * the REST v1 delete gate, the documents-list `canManage` annotation, and the
 * share-link capability check never diverge.
 *
 * `memberRole` is the caller's role in the document's workspace (`undefined`
 * when they are not a member); `authorID` is the document's author (`null` for
 * legacy/orphaned documents, which therefore only the workspace owner can
 * manage — there is always an owner, so no document becomes unmanageable).
 */
export function isDocumentManager(
  memberRole: string | undefined,
  authorID: number | null,
  userId: number,
): boolean {
  return memberRole === 'owner' || authorID === userId;
}
