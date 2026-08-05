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

// Yorkie presence (shipped as `NotesPresence`; the color/name/selection/cursor
// caret fields are identical to CodePair, plus username/email/photo identity
// fields for the shared UserPresence avatar chrome)
type NotesPresence = {
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

- `src/store/` — `NoteStore` interface (mirrors `DocStore` / `Store`) plus a
  `MemNoteStore` for tests. This is the persistence abstraction the CodeMirror
  view talks to; the Yorkie-backed implementation lives in the frontend
  (below), same split as `packages/docs`. Note data types are thin (content is
  a single markdown string) and live in `packages/notes/src/store/store.ts` +
  `packages/notes/src/types.ts` (there is no separate `src/model/` directory).
- `src/view/` — `initialize(container, store, theme, readOnly, viewMode)` →
  `NoteEditorAPI`. Internally builds the CodeMirror 6 `EditorState`:
  `@codemirror/lang-markdown`, `basicSetup` (history **disabled** — Yorkie owns
  undo/redo), light/dark themes, line wrapping, the Yorkie sync binding,
  toolbar, and the preview pane. The CodeMirror↔Yorkie binding was ported
  nearly verbatim from CodePair and lives alongside the view in
  `packages/notes/src/view/note-sync.ts` +
  `packages/notes/src/view/remote-selection.ts` (there is no separate
  `src/yorkie/` directory). It targets Wafflebase's `@yorkie-js/sdk` **0.7.13**
  using only stable `Text` + presence APIs.

The port preserves CodePair's `EditorPort` adapter idea so the app manipulates
the editor (getSelection / replaceRange / getContent / scrollIntoView) without
depending on CodeMirror directly.

#### Frontend integration: `packages/frontend/src/app/notes/`

Mirrors `app/docs/`:

- `notes-detail.tsx` — route component; mounts `<DocumentProvider
  docKey={`note-${id}`} initialRoot={initialNotesRoot()}>` using
  `@yorkie-js/react`.
- `notes-view.tsx` — constructs `YorkieNoteStore` from `useDocument()` and calls
  the engine's `initialize(container, store, theme)`.
- `yorkie-note-store.ts` — `class YorkieNoteStore implements NoteStore`,
  translating store operations into Yorkie `Text` edits inside `doc.update()`
  and applying `remote-change` / `snapshot` events back into the store. This is
  the Wafflebase-native equivalent of CodePair's `useYorkieDocument` +
  `yorkieSync` glue, adapted to `@yorkie-js/react`'s provider pattern.
- Yorkie root type + seed live in `packages/frontend/src/types/notes-document.ts`
  (`YorkieNotesRoot`, `initialNotesRoot()`), same location convention as
  `packages/frontend/src/types/docs-document.ts`.

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

- **Yorkie SDK version skew (resolved).** The ported binding only uses stable
  `Text` + presence APIs (`edit`, `toString`, `posRangeToIndexRange`,
  `indexRangeToPosRange`, `getPresences`); it shipped against Wafflebase's
  `@yorkie-js/sdk` **0.7.13** with store-level tests pinning the behavior.
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

#### Undo/redo — Yorkie-native (`doc.history`) — shipped (issue #604)

P1 undo/redo ran through CodeMirror's own history: local edits were the only
thing in it (remote changes were excluded with
`Transaction.addToHistory.of(false)`), so undo restored a **local snapshot**
and then pushed that snapshot forward into Yorkie as a fresh edit. In a
collaborative session that clobbers whatever a peer typed between the edit
and the undo — there was no guarantee undo reverted "only what I just did".

Notes now uses the same Yorkie-native pattern as Slides
([slides-native-undo.md](../slides/slides-native-undo.md)) and Docs:

- **1 batch = 1 Yorkie change = 1 undo unit.** `NoteStore` gained
  `batch(fn)`; `YorkieNoteStore` keeps an **ambient root** — a top-level
  `batch()` opens ONE `doc.update()` and every `editText` runs against that
  root via `withUpdate()`. Nested batches short-circuit into the outermost
  one. `note-sync` wraps one CodeMirror `ViewUpdate` in one batch, so a
  command that dispatches several changes (e.g. `insertTable`) undoes in a
  single step. A batch that mutates nothing records no undo unit (an empty
  `doc.update` pushes nothing).
- **Reverse ops, not snapshots.** `undo()/redo()` delegate to
  `doc.history`, which applies the reverse of that change's ops — a peer's
  concurrent edit survives. Verified against `@yorkie-js/sdk` 0.7.13: the
  `Tree.editByPath` merge non-reversibility that affects Docs does not apply
  here, since a note's whole content is one `Text`.
- **Undo floor.** `YorkieNoteStore` captures the undo-stack depth at
  construction (i.e. after `notes-view.tsx`'s `ensureText()` seed) and
  `canUndo()` refuses to drop below it, so the seed itself can't be undone
  away — mirrors `YorkieDocStore.undoFloor`.
- **The undo result re-enters the editor as a remote change.** Yorkie emits
  the reverse ops as a `local-change` with `source === 'undoredo'`; the
  formerly dormant `isUndoRedo` branch of `subscribeRemote` now forwards it
  to `noteSync`, which applies it as a `remote`-annotated transaction — so
  it never echoes back as a new forward edit.
- **Keybindings.** `basicSetup` runs with `history: false` /
  `historyKeymap: false`; `Mod-z` / `Mod-Shift-z` / `Mod-y` are bound to the
  store (and left unbound entirely on a read-only mount). Vim's `u` /
  `<C-r>` reach the same place: `@replit/codemirror-vim` resolves them
  through `CodeMirror.commands.undo/redo` at call time, which the engine
  re-points at the store from the view's `noteStoreFacet`. (Its `:undo` /
  `:redo` ex-commands snapshot the original handlers at module load and
  cannot be re-routed; they are inert.)

One behavior change: CodeMirror grouped keystrokes into a time window
(`newGroupDelay`), while Yorkie's unit is the change — so undo now steps per
CodeMirror transaction. Docs and Slides behave the same way after their
migrations.

#### Collapsible sections (`<details>` / `<summary>`) — shipped (issue #542)

The preview runs `markdown-it` with `html: false` (raw HTML in a
collaborator's note is a stored-XSS vector). To support GitHub/MDN-style
foldouts without weakening that posture, a narrow allowlist plugin
(`packages/notes/src/view/details-plugin.ts`) recognizes **only** the
`<details>` / `<summary>` disclosure tags as block tokens and emits safe
`<details class="note-details" [open]>` / `<summary class="note-summary">`
elements (fixed class + boolean `open` only). The summary label and the
folded body are still parsed through the normal `html: false` pipeline, so
nested markdown (including nested disclosures) works while no arbitrary HTML
is ever produced. `<details open>` renders expanded by default; a stray
`</details>` with no matching open falls through and is escaped as literal
text. Styling lives in `packages/frontend/src/app/notes/notes-preview.css`.

#### Mermaid diagrams — shipped (issue #625)

A ` ```mermaid ` fence renders as a diagram rather than a code block, matching
GitHub / Obsidian / Notion (and this repo's own design docs). The fence rule in
`preview.ts` branches on the info string; everything else lives in
`packages/notes/src/view/mermaid.ts`:

- **Placeholder first, SVG later.** The fence emits a synchronous
  `<div class="note-mermaid" data-mermaid-pending>` carrying the *escaped*
  diagram source in a `<pre>`. `NotePreview.render()` then kicks
  `renderMermaidBlocks()`, which swaps in the SVG. A diagram that has not
  rendered yet, does not parse, or whose engine failed to load therefore
  degrades to readable source instead of a blank block; a parse failure also
  prepends the mermaid error message.
- **Lazily imported.** `mermaid` (~3 MB, and it splits itself per diagram
  type) is reached only through `import('mermaid')` inside that module, so it
  costs the notes route nothing until a note actually contains a mermaid
  fence — `notes-view-*.js` grew 2.25 kB. The measured chunk-count effect is
  recorded in `harness.config.json`'s `maxChunkCountReason`.
- **Cached per (source, theme).** Split mode re-renders on every keystroke;
  outcomes (SVG *and* errors — a diagram is unparseable for most of the time
  it is being typed) are memoized in a bounded **least-recently-used** map
  (reads move the entry back to the end, so a stable diagram is not evicted by
  the one-shot sources typing an adjacent diagram produces), and cache hits are
  applied inside the synchronous `render()` call so an unchanged diagram never
  flashes back to source. Mermaid bakes the palette into its SVG, so the
  light/dark theme is part of the key and `NoteEditorAPI.setTheme` repaints the
  preview.
- **One pass at a time.** Mermaid's config (including the palette) and layout
  engine are process-global singletons, so passes are queued on a single chain:
  at most one `mermaid.render()` is ever in flight, and a diagram can no longer
  be laid out under one theme while being cached under the other's key. Each
  `render()` also bumps a per-root pass counter, so a pass whose DOM a newer
  `render()` replaced abandons its remaining diagrams instead of racing for
  them (`root.contains(el)` remains as a second guard for a placeholder
  detached without a re-render). Together those make the undebounced
  per-keystroke `render()` safe.
- **Security: three layers, not one.** The rendered SVG is the preview's only
  `innerHTML` assignment of note-derived markup, and note content is untrusted
  (a collaborator or editor-role share-link visitor authors it, someone else
  renders it), so the `html: false` "no raw note HTML" rule is not delegated to
  the engine alone: (1) `securityLevel: 'strict'` with `startOnLoad: false`
  sanitizes labels and ignores `click` directives, and an extended `secure` key
  list pins the theming keys; (2) `stripConfigDirectives()` removes
  `%%{init: ...}%%` directives and `config:`-bearing front matter from the
  fence body, so a note cannot push `themeCSS`/`themeVariables` into the
  document-scoped `<style>` mermaid emits inside the SVG; (3)
  `sanitizeSvgMarkup()` re-parses the engine's output in an inert `<template>`
  and drops scripts, `on*` handlers, URL attributes outside
  `#`/`http(s)`/`mailto:`, and `@import`/external `url()` CSS references before
  it reaches the live DOM. `securityLevel: 'sandbox'` (mermaid's own advice for
  untrusted input) is deliberately not used — it iframes every diagram, which
  breaks sizing, text selection and the light/dark surface; the local sanitize
  pass is the substitute.

#### Empty nested bullet vs setext heading — shipped (issue #517)

CommonMark has a genuine ambiguity: a lone `-` on the line after a paragraph is
a valid **setext heading underline**, so

```
- 1
  -
```

renders (in strict CommonMark, and on GitHub) as `<li><h2>1</h2></li>` — the
empty nested bullet a user is typing turns the parent's text into a Header 2.
Two upstream guards conspire: `markdown-it`'s `lheading` rule claims the lone
`-` as an underline before `list` runs, and even without `lheading` the `list`
rule refuses to let an *empty* bullet interrupt a paragraph (it degrades to
lazy `1<br>-` text).

`packages/notes/src/view/list-empty-bullet-plugin.ts` makes the notes preview
deviate — deliberately and narrowly — toward the intuitive reading: a **lone
single `-`** (the empty-bullet shape) is never a setext underline, and an empty
bullet is allowed to interrupt a paragraph so it nests as an empty child item.
Multi-dash `---` and `=` setext underlines are untouched, so ordinary setext
headings still render. This is a notes-preview-only rendering choice, not a
change to the shared markdown model.

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
