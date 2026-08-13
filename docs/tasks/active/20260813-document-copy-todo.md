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

## Out of scope

- REST v1 / CLI copy endpoint.
- Copying comments, share links, or history (explicitly excluded).
- Copying into a *different* workspace or folder (that is Move's job).
