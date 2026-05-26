# Docs Comments — Lessons

Captured while building Tasks 1–3 of the docs-comments roadmap. These
all bit during implementation despite being designable in advance had
they been on the radar.

## Yorkie type quirks (0.7.x)

### JS numbers > 2^32 silently truncate

`Date.now()` (~1.78e12) stored on a Yorkie object is treated as
`PrimitiveType.Integer` (32-bit) and gets sliced to its low 32 bits on
the wire. Remote peers decode timestamps like 1970-01-06 — local-only
tests never catch this because the truncation happens at serialization.

**Apply:** Coerce timestamps to `BigInt` before assigning to a Yorkie
object; convert back to `number` when reading. The sheets comments code
already does this (`toYorkieMs` / `fromYorkieMs`). Mirrored verbatim in
`yorkie-comment-store.ts`.

### CRDT proxies can't be spread or cloned

Pure helpers that build a new thread with `{ ...thread, comments: [...] }`
fail on a Yorkie proxy with `TypeError: Unsupported type of value:
function` — the spread copies the proxy's method bindings as own
properties, which Yorkie then refuses when re-storing.

**Apply:** Inside `doc.update`, mutate the proxy in place
(`thread.comments.push(reply)`, `delete root.comments![id]`,
`c.body = text; c.editedAt = ts`). Never use the pure helpers on a
proxy. Pure helpers stay useful for `MemCommentStore` where threads are
plain JS objects.

### posRangeToPathRange collapses paths on full deletion (no throw)

The design assumed full block deletion would make the SDK *throw* when
resolving the posRange. Empirically (0.7.8) it returns a 1-level path
like `[[0],[0]]` instead. The signature is roughly: deleted endpoints
collapse onto the deleted node's tomb, the path is truncated to the
parent of the deletion.

**Apply:** `resolveDocsAnchor` treats *either* a throw or a path with
length < 3 as orphan (`[blockIdx, inlineIdx, charOffset]` is the
canonical length). Documented in design §2 and §5. Verified with a
disposable probe test inside packages/frontend/tests/.

## Node test runner + TypeScript constraints

### Parameter properties forbidden under `--experimental-strip-types`

`constructor(private readonly doc: yorkie.Document<...>)` fails with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Strip-only mode does not implement
TS-specific syntax that emits code (this includes parameter properties,
enums, namespaces).

**Apply:** Declare fields explicitly and assign in the constructor body.
Existing modules in `packages/frontend/src/app/docs/` already follow
this pattern.

## Architecture boundary in `src/types/**`

The eslint arch config forbids `src/types/**` from importing
`@/components/*`, `@/app/*`, `@/api/*`, `@/hooks/*`. Putting cross-cutting
type definitions inside `src/types/comments.ts` (then re-exporting from
`src/components/comments/types.ts`) lets `src/types/docs-document.ts`
embed `Thread<DocsRangeAnchor>` without violating the boundary.

**Apply:** Cross-feature type shapes consumed by `src/types/**` must live
in `src/types/**`. Component modules re-export type names from there.

## Storing CRDT-position ranges as JSON

`TreePosStructRange` is the SDK's serializable form
(`{ parentID, leftSiblingID }` × 2). It looks like an internal type but
is the documented stable handle for "this position in the tree, even
after concurrent edits." Storing it directly in `root.comments` is
correct; trying to round-trip through `JSON.stringify` and back works
naturally because the struct is plain data.
