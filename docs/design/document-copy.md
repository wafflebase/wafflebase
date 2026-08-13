---
title: document-copy
target-version: 0.2.0
---

# Make a Copy — Document Duplication

## Summary

`POST /documents/:id/copy` produces an independent duplicate of a document in
the same workspace and folder, named `<title> (copy)`. The documents list
exposes it as **Make a copy** in the row menu and in the bulk action bar.

Duplicating a document is the natural template workflow — a weekly report, a
meeting-notes doc, a deck reused per client. Before this, the only workarounds
were copy/paste (loses extra tabs, formatting, structure) or export/re-import
(loses editor-specific data), and editing the original in place makes
experimentation risky.

### Goals

- One action duplicates a document of **any** type with its full content.
- The copy is independent: deleting the source leaves it intact.
- The copy is a new document — new author, new timestamps, no inherited
  collaboration state.
- Anyone who can **read** the document can copy it.

### Non-Goals

- **Change history.** The copy starts from the source's current snapshot with a
  fresh Yorkie history. Copying CRDT history is neither needed nor expressible
  through the SDK.
- **Collaboration state.** Comments, share links, presence, and analytics are
  deliberately not carried over: a copy is a new document, and a share link
  minted for the source must not silently grant access to the duplicate.
- **Copying elsewhere.** The copy always lands beside its source. Moving it is
  Move's job, and Move is already manager-gated.
- **REST v1 / CLI copy.** Not exposed there; the web list is the only caller.

## Proposal Details

### Where the copy happens: the server

The copy runs entirely in the backend. The alternative — copying in the browser
— would need type-specific duplication logic on the client for all eight
document types, plus a download-and-re-upload round trip through the user's
connection for blob documents. The backend already owns every piece:
`YorkieService.withDocument` for CRDT access, `FileService` for blobs, and
`WorkspaceService.assertMember` for the permission check.

```
POST /documents/:id/copy      →  201 { …the new Document row }
```

Gated on **workspace membership only**, deliberately *not* on
`isDocumentManager`. Copying does not modify, move, or destroy the source, so
the manager tier that guards move/delete does not apply — a plain member who
can read a document can duplicate it. This is the one document action where
that gate intentionally diverges.

### Naming

`copyTitle()` (`document/document-copy-title.util.ts`) resolves the name
against the titles already present in the destination workspace **and folder**:

| Existing                              | Result             |
| ------------------------------------- | ------------------ |
| `Report`                              | `Report (copy)`    |
| `Report`, `Report (copy)`             | `Report (copy 2)`  |
| `Report`, `Report (copy)`, `(copy 2)` | `Report (copy 3)`  |

Titles are not unique in the data model, so this is cosmetic de-duplication,
not a constraint: two concurrent copies of the same document can both land on
`(copy 2)`. That is acceptable — the list tolerates duplicate titles today.
The result is clamped to 200 characters (the rename DTO's limit) so a copy is
always renameable through the UI.

### What "full content" means per type

The dispatch is by document `type`, and every arm is a *snapshot write into a
brand-new Yorkie document key*. The target key (`<prefix>-<newId>`) has never
been attached to by anyone, so the last-write-wins contract that
`writeDocsRoot`/`writeNoteRoot` carry has nothing to race against.

| Type                      | How the content is copied                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sheet`, `slides`, `board` | Whole-root JSON snapshot: `JSON.parse(source.toJSON())`, then every key assigned onto the new root. These roots hold plain JSON (no `Tree`/`Text`), so this copies all tabs / slides / elements — and any field added later — with no per-type knowledge. Same technique as `scripts/copy-yorkie-documents.ts`. |
| `doc`                     | `readDocsRoot()` → `writeDocsRoot()`. The body is a Yorkie `Tree`, which serializes to JSON but cannot be written back by assignment, so the copy goes through the existing docs serializer (the one the CLI content endpoints use). |
| `note`                    | `readNoteRoot()` → `writeNoteRoot()`. Same reason: the body is a single Yorkie `Text`.                             |
| `pdf`, `image`, `file`    | S3 `CopyObject` into a fresh object key (`FileService.copy`). Server-side copy — the bytes never enter the backend process. `fileSize` / `mimeType` are carried over from the source row: they describe the same bytes. The new document references the new key, so deleting the source (which deletes its blob) cannot break the copy. |

Because the `doc` arm reuses `readDocsRoot`/`writeDocsRoot`, it inherits their
documented limitations (legacy header/footer shapes are not migrated; inline
images are opaque attribute strings). That is the same fidelity the CLI's
content round trip already has; a dedicated CRDT-level clone would be the only
way to do better and is out of scope here.

### Failure handling

Order matters, because a partially-created copy is worse than none:

1. Resolve the title (a read).
2. Copy the blob, if any. Failure → nothing has been created; the error
   surfaces.
3. Create the `Document` row. Failure → delete the just-copied blob, then
   rethrow (mirrors `ApiV1FilesController`'s upload rollback).
4. Copy the Yorkie content, if any. Failure → delete the row we just created,
   then rethrow, so the user never sees an empty document claiming to be a
   copy.

Step 4's rollback is the one place this differs from the import queue, which
deliberately leaves an empty document behind for a retry to fill. A copy has no
retry affordance in the UI, so it rolls back instead.

### Frontend

`copyDocument(id)` in `api/documents.ts`. In `document-list.tsx`:

- Row menu: **Make a copy** between *Rename* and *Move to…*, shown for every
  document regardless of `canManage`.
- Bulk bar: **Make a copy** beside *Move to…*, also ungated. It copies the
  selected documents sequentially (one request each) — the same shape as the
  existing bulk Download, and copies need no atomicity because each one is
  independent.

After copying, the list refetches and the copy appears next to its source. It
does **not** navigate: bulk copy produces N documents with no single one to
open, and a single copy behaving the same way keeps the action predictable.
Folders in a selection are ignored — copying a folder tree is a different
feature.

## Risks and Mitigation

| Risk | Mitigation |
| ---- | ---------- |
| A large document makes the request slow (the backend attaches to two Yorkie documents and holds one snapshot in memory). | Bounded by what the editor already loads for a single document; copies are user-initiated and infrequent. Bulk copy is sequential, so N copies never fan out into N concurrent attaches. |
| A reader copies a document to escape a permission boundary. | There is no boundary to escape: the copy lands in the same workspace, and read access to the source already implies read access to its content. The copier becomes the copy's author, so the audit trail names them. |
| Concurrent copies collide on a title. | Titles are not unique in the model, and the list already tolerates duplicates. |
| A live editing session on the source races the snapshot read. | The copy reflects whatever the source held at read time — the same guarantee any snapshot read (export, CLI content GET) gives. |
