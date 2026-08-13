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

## What running it for real turned up

The first pass left the Yorkie-attached and MinIO paths to CI. Both were then
exercised locally, and each one found something the mocked tests could not:

- **`CopyObject` did not work at all** — not because of the command arguments,
  but because `@aws-sdk/xml-builder` registers a `#xD` XML entity that
  `fast-xml-parser` 5.7.0/5.7.1 reject, so *any* S3 response with an XML body
  failed to deserialize. Uploads and downloads never noticed (no XML body),
  which is why this sat undetected until a feature needed `CopyObject`. Fixed
  by raising the repo's security override floor to 5.7.2, where upstream fixed
  the regression. **Lesson: a mocked S3 client asserts your arguments, never
  the round trip. Run the real thing once.**
- **The snapshot fallback chain was untestable as written** — the unit test's
  fake root was a plain object with no `toJSON`, so it never reproduced the
  proxy semantics the fallback exists for, and the fallback re-parsed the same
  broken string it was falling back *from*. The repair and proxy-walk tiers now
  live in `yorkie/yorkie-json.ts`, shared with
  `packages/backend/scripts/copy-yorkie-documents.ts` (which already had them), and
  `test/document-copy-attached.e2e-spec.ts` runs the JSON arm against a real
  Yorkie server on both ends. **Lesson: when a fake has to omit the very
  property under test, that is the signal to reach for an attached test.**

`CopySource` is now encoded per path segment rather than wholesale. MinIO
accepts both forms (it unescapes `%2F`), so this is contract correctness, not
an observed failure.
