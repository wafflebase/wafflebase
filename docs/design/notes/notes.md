---
title: notes
target-version: 0.2.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Notes — Markdown Note Type

## Summary

Add a fourth first-class **collaborative document type** to Wafflebase: a
**markdown note** (`note`), sourced from the
[CodePair](https://github.com/yorkie-team/codepair) editor. A note is edited as
**raw markdown source text with a live HTML preview** (CodeMirror 6, not
WYSIWYG), and its entire content lives in a single Yorkie `Text` CRDT at
`root.content` — identical to CodePair's schema.

Wafflebase already provides everything CodePair had to build itself:
workspaces, share links, per-document auth webhook, and the `updatedAt` edit
webhook. All of that infrastructure is **type-agnostic** and keys off the
Yorkie docKey, so a new note type inherits collaboration, sharing, and access
control for free once a `note-` docKey prefix is registered.

This document specifies **Phase 1 (P1)** — the editor engine plus the `note`
document type — in full. It sketches later phases (feature parity, migration)
at the end. AI/RAG ("Yorkie Intelligence") from CodePair is **explicitly out of
scope** and will not be ported.

The long-term goal is to **decommission CodePair** and serve markdown notes
from Wafflebase. Because the Yorkie schema is byte-compatible with CodePair,
document migration reduces to re-keying / copying Yorkie documents plus mapping
metadata rows — designed in a later phase (P3).

### Goals

- Ship a `note` document type editable as collaborative markdown source with a
  side-by-side preview, at parity with CodePair's core editing experience.
- Reuse Wafflebase's existing collaboration infrastructure (auth webhook, edit
  webhook, share links, presence) **without type-specific branching** — only a
  new docKey prefix registration.
- Package the editor as a standalone engine package `@wafflebase/notes`,
  mirroring the `packages/docs` / `packages/slides` engine-package convention.
- Keep the Yorkie document schema **byte-compatible with CodePair**
  (`{ content: Text }`) so that a future migration is a re-key, not a
  conversion.
- Create, list, open, and share notes from the existing documents UI.

### Non-Goals

- **AI / RAG (Yorkie Intelligence)** — not ported now or later (RAG removed
  from scope per product decision).
- **WYSIWYG editing** — notes are markdown *source* editors, deliberately not
  the `packages/docs` canvas rich-text engine.
- **Phase-1 feature parity extras** — image upload, PDF/HTML/MD export,
  revision history, and vim mode are deferred to P2 (see Later Phases).
- **The actual CodePair data migration** — designed and executed in P3; only
  its shape is sketched here. (Whether CodePair runs in production with real
  user data, and whether it shares a Yorkie server/project with Wafflebase, are
  open questions to investigate before P3.)
- **Folder / tree organization** — notes join the existing flat
  per-workspace document list, same as every other type.

## Proposal Details

### Decomposition

This is a multi-subsystem effort split into independently shippable phases.
Only **P1** is fully specified here.

| Phase | Scope | Depends on |
| ----- | ----- | ---------- |
| **P1** | Notes editor engine (`@wafflebase/notes`) + `note` document type wired into backend/frontend, inheriting collaboration/sharing/auth | — |
| **P2** | Feature parity: image upload, PDF/HTML/Markdown export, revision history, vim mode | P1 |
| **P3** | CodePair → Wafflebase migration: users, workspaces, memberships, share tokens, and Yorkie documents | P1 |

AI/RAG is removed from scope entirely (no P4).

### P1 Architecture

CodePair's Yorkie schema is tiny, which is what makes this port small:

```ts
// Yorkie document root (identical to CodePair)
type NoteRoot = { content: yorkie.Text };

// Yorkie presence (identical to CodePair)
type NotePresence = {
  color: string;
  name: string;
  selection: yorkie.TextPosStructRange | null;
  cursor: [number, number] | null;
};
```

The whole markdown document is one flat string in one `Text` CRDT. There is no
block/Tree structure. This is the load-bearing decision that keeps both the
editor port and the future migration simple.

#### Engine package: `packages/notes` (`@wafflebase/notes`)

Follows the `packages/docs` engine-package convention (private ESM/CJS lib,
Vite + `vite-plugin-dts`, browser + `./node` export conditions, `src/index.ts`
barrel). CodePair's `packages/codemirror` is ported here and reorganized to
match Wafflebase's engine shape:

- `src/model/` — note data types. Thin: content is a single markdown string.
- `src/store/` — `NoteStore` interface (mirrors `DocStore` / `Store`) plus a
  `MemNoteStore` for tests. This is the persistence abstraction the CodeMirror
  view talks to; the Yorkie-backed implementation lives in the frontend
  (below), same split as `packages/docs`.
- `src/view/` — `initialize(container, store, theme)` → `EditorAPI`. Internally
  builds the CodeMirror 6 `EditorState`: `@codemirror/lang-markdown`,
  `basicSetup` (history **disabled** — Yorkie owns undo/redo), light/dark
  themes, line wrapping, the Yorkie sync binding, toolbar, and the preview
  pane (`@uiw/react-markdown-preview` or equivalent).
- `src/yorkie/` — the CodeMirror↔Yorkie binding ported nearly verbatim from
  CodePair (`yorkieSync.ts`, `remoteSelection.ts`, `index.ts`). Adjusted for
  Wafflebase's `@yorkie-js/sdk` **0.7.8** (CodePair uses 0.7.12 — the `Text`
  and presence APIs used here are stable across that gap, but the port must be
  verified against 0.7.8).

The port preserves CodePair's `EditorPort` adapter idea so the app manipulates
the editor (getSelection / replaceRange / getContent / scrollIntoView) without
depending on CodeMirror directly.

#### Frontend integration: `packages/frontend/src/app/notes/`

Mirrors `app/docs/`:

- `notes-detail.tsx` — route component; mounts `<DocumentProvider
  docKey={`note-${id}`} initialRoot={initialNoteRoot()}>` using
  `@yorkie-js/react`.
- `notes-view.tsx` — constructs `YorkieNoteStore` from `useDocument()` and calls
  the engine's `initialize(container, store, theme)`.
- `yorkie-note-store.ts` — `class YorkieNoteStore implements NoteStore`,
  translating store operations into Yorkie `Text` edits inside `doc.update()`
  and applying `remote-change` / `snapshot` events back into the store. This is
  the Wafflebase-native equivalent of CodePair's `useYorkieDocument` +
  `yorkieSync` glue, adapted to `@yorkie-js/react`'s provider pattern.
- Yorkie root type + seed live in `packages/frontend/src/types/notes-document.ts`
  (`YorkieNotesRoot`, `initialNoteRoot()`), same location convention as
  `types/docs-document.ts`.

#### Data flow (collaboration)

Identical to CodePair, which is why the Yorkie format stays compatible:

1. Local CodeMirror edit → iterate `tr.changes` → `doc.update(root =>
   root.content.edit(from, to, text))` (with running offset adjustment).
2. Yorkie syncs the op to peers.
3. Remote peer receives `remote-change` → translate Yorkie ops whose `op.path`
   starts with `$.content` into CodeMirror transactions tagged with a `remote`
   annotation (prevents echo loops).
4. `snapshot` event → replace editor contents from `content.toString()`.
5. Presence: local selection pushed via `content.indexRangeToPosRange()`;
   peers' `TextPosStructRange` converted via `content.posRangeToIndexRange()`
   into colored-selection + named-caret decorations.

### P1 Extension Points

Wafflebase's collaboration infra (auth webhook, edit webhook, share links,
presence) is **entirely docKey-driven and type-agnostic** — registering the
`note-` prefix is what lights it all up. The concrete code changes:

**Backend**

1. `packages/backend/src/document/document.dto.ts` — add `'note'` to
   `DOCUMENT_TYPES` (the `@IsIn` validation union).
2. `packages/backend/src/yorkie/yorkie-doc-key.ts` — register `note: 'note-'`
   in `YORKIE_DOC_KEY_PREFIXES`, the `DocumentTypeLike` union, and the switch.
   ⚠️ **Required** — `yorkieDocKeyPrefix` throws and `parseYorkieDocKey` returns
   `null` for unknown types, so without this the auth/edit webhooks reject
   every note document.

No Prisma migration is needed: `Document.type` is a plain `String` column and a
new value requires no schema change. `note` documents do not use `fileId`
(PDF-only), so `assertFileIdAllowed` needs no change.

**Frontend**

3. `packages/frontend/src/types/documents.ts` — add `"note"` to
   `DocumentType`.
4. `packages/frontend/src/app/documents/document-list-utils.ts` — add a
   `getDocumentPath` case mapping `note` → `/n/`.
5. `packages/frontend/src/App.tsx` — add a lazy route `/n/:id` → `NotesDetail`.
6. `packages/frontend/src/app/documents/document-list.tsx` — add a "New note"
   create mutation calling `createDocument({ title, type: 'note' })` then
   `navigate(getDocumentPath(created))`.
7. `packages/frontend/src/app/shared/shared-document.tsx` — add the note branch
   so shared links render the notes editor.
8. New `app/notes/` components + `types/notes-document.ts` + `YorkieNoteStore`
   (above).

Everything else — attach/detach auth (`yorkie-auth.controller.ts`),
`updatedAt` bumping (`yorkie-event.controller.ts`), share-link role
enforcement, and presence peer cursors — works unchanged once step 2 registers
the prefix.

### Inherited for free (no code changes)

- **Per-document access control** — `yorkie-auth.controller.ts` calls
  `parseYorkieDocKey` and enforces workspace membership / share-link role by
  `documentId`; it does not branch on type.
- **Last-modified ordering** — `yorkie-event.controller.ts` bumps
  `Document.updatedAt` on `DocumentRootChanged`.
- **Sharing** — `ShareLink` model + `share-link.service` + `shared-document`.
- **Presence peer cursors** — Yorkie presence via `@yorkie-js/react`,
  `usePresenceUpdater`, `UserPresence`.

### Risks and Mitigation

- **Yorkie SDK version skew (0.7.12 → 0.7.8).** CodePair's binding targets a
  newer SDK. *Mitigation:* the ported binding only uses stable `Text` +
  presence APIs (`edit`, `toString`, `posRangeToIndexRange`,
  `indexRangeToPosRange`, `getPresences`); verify each against 0.7.8 during the
  port and pin behavior with a store-level test.
- **CodeMirror as a new frontend dependency / bundle size.** Wafflebase editors
  are Canvas-based; CodeMirror 6 + markdown lang + preview is a new, sizable
  dependency loaded only on the `/n/:id` route. *Mitigation:* lazy-load the
  notes route (already the App.tsx pattern) so it doesn't affect other
  editors; watch the frontend chunk-gate (`harness.config.json`).
- **Editor↔store abstraction leak.** CodePair mixes CodeMirror and Yorkie
  directly; Wafflebase requires a `Store` boundary. *Mitigation:* define a
  clean `NoteStore` interface with a `MemNoteStore` so the engine is testable
  without Yorkie, matching `packages/docs`.
- **Migration compatibility drift (future P3).** Any change to the note Yorkie
  schema breaks byte-compatibility with CodePair. *Mitigation:* freeze the
  `{ content: Text }` root shape for P1; treat schema changes as migration
  events.

## Later Phases (sketch)

### P2 — Feature parity

Port, in priority order, from CodePair: image upload (presigned S3/MinIO URLs +
paste/drop → `![](url)` insertion), export (PDF/HTML/Markdown via
`markdown-it`), revision history panel, and vim mode. Each is additive and
route-local.

**CLI (shipped).** A `notes` namespace (alias `note`) in `@wafflebase/cli`
brings notes to parity with the `docs`/`slides` namespaces:
`list / create / get / rename / delete / content / export / import`. Because a
note's content *is* its markdown string in one Yorkie `Text` at `root.content`,
the pipeline is the thinnest of the three — no lossy serialization:

- `notes content <id>` → `{ "content": "…" }` for `--format json`, raw markdown
  for `md`/`text`.
- `notes export <id> <file.md>` → markdown only (PDF/HTML export still deferred
  above).
- `notes import <file.md>` → creates (or `--replace`s) a note from a markdown
  file or stdin.

The backend reuses the shared `GET`/`PUT /api/v1/.../documents/:id/content`
endpoint, adding a `note` arm that reads/writes the `Text` via
`packages/backend/src/yorkie/note-content.ts` (mirrors the `doc`/`slides`
tree readers/writers). The v1 `POST /documents` create path also learned to
accept `type: 'note'` (it previously downgraded unknown types to `sheet`).
See [cli.md](../cli.md).

### P3 — CodePair → Wafflebase migration

Because note content lives **only in Yorkie** and the schema is identical:

1. Map CodePair Mongo `Document` rows → Wafflebase Postgres `Document` rows
   (type `note`), preserving or re-keying the docKey to the `note-` prefix.
2. Move / copy the Yorkie documents (same project/server re-key, or
   cross-server copy — TBD, pending the open Yorkie-topology question).
3. Map `User`, `Workspace`, `UserWorkspace` memberships, and
   `DocumentSharingToken` → Wafflebase `User` / `Workspace` /
   `WorkspaceMember` / `ShareLink`.

**Open questions to resolve before P3:** does CodePair run in production with
real user data (migration volume), and do CodePair and Wafflebase share a
Yorkie server/project (determines re-key vs. copy)?
