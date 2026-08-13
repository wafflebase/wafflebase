# Make a copy — duplicate a document (issue #765)

## Goal

Add a **Make a copy** action that produces an independent duplicate of a
document, from the document row menu and the bulk action bar.

## Decisions (issue asked for them up front)

1. **Where does copying happen?** Server side, `POST /documents/:id/copy`.
   Yorkie duplication, blob copying, and the permission check stay on the
   backend; the browser never fetches or re-uploads the content.
2. **What is copied for Yorkie documents?** The current snapshot only. No
   change history, no comments, no share links, no presence.
3. **What happens after copying?** The copy stays next to the source in the
   list (list refetch, no navigation). Bulk copy produces N rows, so
   navigating away from the list would be wrong for it, and a single copy
   behaves consistently with it.

## Plan

- [x] Design doc `docs/design/document-copy.md` + README link.
- [x] `copyTitle()` pure util: `<title> (copy)`, `(copy 2)`, `(copy 3)` …
- [x] `FileService.copy()` — server-side S3 `CopyObject` under a fresh key.
- [x] `DocumentCopyService.copy()` — resolve title, copy blob or Yorkie
      content, create the row, roll back on failure.
- [x] `POST /documents/:id/copy` — workspace-member gated (NOT `canManage`).
- [x] Frontend `copyDocument()` API + row menu item + bulk bar button.
- [x] Unit tests: title util, copy service, controller endpoint.

## Review follow-ups (human intervention after the agent panel paged)

- [x] Share the snapshot normalizer with `scripts/copy-yorkie-documents.ts`
      (`yorkie/yorkie-json.ts`): control-character repair + proxy-walk fallback,
      which the copy service's own fallback re-parsed its way back into.
- [x] `CopySource` encoded per path segment, not wholesale.
- [x] Raise the `fast-xml-parser` override floor to 5.7.2 — 5.7.0/5.7.1 reject
      the AWS SDK's `#xD` entity, which broke every `CopyObject`.
- [x] Discard the copied blob only when its row was actually rolled back.
- [x] Refuse an unknown document type instead of copying it as empty.
- [x] Pending-guard the row menu's *Make a copy*.
- [x] `test/document-copy-attached.e2e-spec.ts` — JSON-root arm against a real
      Yorkie server (control character, Long timestamp, comment stripping).
- [x] Endpoint tables in `packages/backend/README.md`, `docs/design/backend.md`,
      `docs/design/frontend.md`.

## Out of scope

- REST v1 / CLI copy endpoint.
- Copying comments, share links, or history (explicitly excluded).
- Copying into a *different* workspace or folder (that is Move's job).
