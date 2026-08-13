# Lessons — Make a copy (issue #765)

## What the codebase already had

- `packages/backend/scripts/copy-yorkie-documents.ts` already copies a Yorkie
  document root across servers via `JSON.parse(doc.toJSON())` + a
  delete-all-keys / reassign `replaceRoot`. That confirmed the whole-root JSON
  snapshot approach for the types whose root is plain JSON (`sheet`, `slides`,
  `board`) — no per-field knowledge needed, so a new root field is copied
  automatically.
- `doc` and `note` cannot use that path: their content lives in `Tree` / `Text`
  CRDTs, which serialize to JSON but cannot be *written back* by assignment.
  The backend already had the readers/writers for them
  (`yorkie/docs-tree.ts`, `yorkie/note-content.ts`, built for the CLI content
  endpoints), so the copy reuses those rather than adding a second serializer.

## Gotchas

- Yorkie root proxies serialize via `toJSON()` returning a JSON **string**, so
  `JSON.stringify(root)` double-encodes. `slides-tree.ts` had a private
  `unwrapJson` for this; it is now shared as `yorkie/yorkie-json.ts`.
- `writeDocsRoot`/`writeNoteRoot` are documented last-write-wins primitives.
  That is harmless here because the target document is brand new — nothing
  concurrent can exist on a doc key nobody has ever attached to.
- Blob copy uses S3 `CopyObject`, so the bytes never pass through the backend
  process. `fileSize`/`mimeType` are carried over from the source row because
  they describe the same bytes.
- Copy is gated on workspace membership only, not `isDocumentManager` — it
  never modifies the source. That is the one document action that intentionally
  diverges from the move/delete gate.

## Not verified locally

Yorkie-attached and DB-backed behavior (the real copy of a live `doc`/`note`
document, and the S3 `CopyObject` against MinIO) was left to CI's
`verify-integration` lane; only the unit-level specs ran locally.
