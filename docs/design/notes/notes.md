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
  revision history, and vim mode are deferred to P2 (see Later Phases; image
  upload and vim mode have since shipped there).
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
Vite for the JS bundle + `tsc` against the package build tsconfig for the
declarations,
browser + `./node` export conditions, `src/index.ts` barrel). CodePair's `packages/codemirror` is ported here and reorganized to
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

Port, in priority order, from CodePair: image upload (shipped, below), vim mode
(shipped — the `NoteKeymap` compartment in `view/editor.ts`), export
(PDF/HTML/Markdown via `markdown-it`), and a revision history panel. Each is
additive and route-local.

#### Image upload — shipped

Paste, drop, and a toolbar picker upload an image and insert `![alt](url)` at
the insertion point. No backend work was needed: notes reuse the workspace
image endpoint (`POST /api/v1/workspaces/:wid/images`) that sheets, slides, and
board already share, through the frontend's existing
`uploadImageFile(file, workspaceId)`. The preview needed nothing either —
`markdown-it`'s image rule already renders the result.

The design departs from CodePair's imageUploader plugin in several places, each
because the naive version misbehaves in a collaborative markdown editor:

- **The in-flight placeholder is view-local, not text.** A note's body is one
  Yorkie `Text` CRDT, so placeholder text would replicate to every peer, enter
  the undo history, and survive as garbage if the upload fails or the tab
  closes mid-flight. `view/image-upload.ts` instead holds a `StateField` of
  widget decorations. `set.map(tr.changes)` is what makes it correct: every
  transaction — the user's own typing *and* a peer's remote edit — moves the
  pending insertion point, so an image that finishes uploading seconds later
  still lands where it was dropped. CodePair reads the selection *after* the
  await, so typing during an upload drops the image mid-word. The one change
  mapping cannot survive is a whole-document replacement — how `noteSync`
  applies a `replace` remote change, i.e. a Yorkie snapshot resync — because
  every anchor lives inside the deleted range and would collapse to position
  0. Those anchors are dropped instead, and the insert falls back to the
  caret rather than dumping the image at the top of the note.
- **A batch inserts in file order, not completion order.** Every request in a
  paste or drop starts at once, but the inserts are committed in sequence:
  the placeholders share one anchor, so letting each insert as it resolves
  would reorder the batch by network speed — paste three screenshots, get
  them back shuffled.
- **A drop inserts at the drop coordinates** (`view.posAtCoords`), not at the
  caret. Dropping a file on a paragraph and watching the image appear
  elsewhere is the most confusing part of the naive implementation.
- **Failure is reported.** The engine's `uploadImage` callback resolves with
  `null` to mean "the host already told the user"; the frontend wrapper in
  `notes-detail.tsx` catches everything `uploadImageFile` throws (unsupported
  type, oversize, network) and raises a toast. CodePair's rejected upload
  becomes `undefined` and is swallowed by an `if (!url) return`.

**An oversized image is downscaled, not refused.** Over the limit, the shared
helper re-encodes the image through `image-downscale.ts` and uploads the
smaller version: the longest side is capped at 4096 px, then progressively
smaller scale steps are tried until the encode lands under the limit. A PNG
source becomes WebP (alpha survives, and it is already in the backend's MIME
allowlist); a JPEG stays JPEG rather than passing through a second lossy codec;
an animated image is never re-encoded at all, because both `createImageBitmap`
and `toBlob` deal in a single frame and a flattened animation is a silent,
unrecoverable loss. The MIME type cannot answer that question — `image/webp` is
as often a sticker as a photo — so the container is sniffed: the `VP8X` ANIM
flag for WebP, an `acTL` chunk before the first `IDAT` for APNG, and GIF is
assumed animated without reading. The PNG chain is walked by its chunk length
prefixes rather than scanned for the four bytes `acTL`, so neither a payload
that happens to spell `acTL` nor a fat colour profile sitting in front of it
changes the answer. Anything the sniff cannot settle — an unreadable file, a
chunk chain longer than the read window — counts as animated, since refusing to
shrink something is recoverable and quietly flattening it is not. Downscaling never throws — a
failed decode or encode yields the original file and `uploadImageFile` produces
the error, so exactly one place decides "too large". The size error names the
limit *and* the sizes ("Image is still 12.5 MB after downscaling (was 40 MB),
over the 10 MB limit"), because the bare limit left the user guessing whether
they missed it by 200 KB or by 40 MB. This lives in
`packages/frontend/src/app/spreadsheet/image-upload.ts`, so sheets, slides, and
board get it too; the docs editor uploads through its own `docxImageUploader`
path and still fails at the backend instead.

The completed upload dispatches a single `input` transaction, which `noteSync`
collapses into one undo unit — Ctrl+Z removes an inserted image in one step.
When the payload carries no image the handlers decline the event rather than
`preventDefault`, so ordinary text paste and drop are untouched.

The engine never imports the frontend: `initialize()` takes an optional
`uploadImage` in its options bag, and a read-only mount never receives one, so
the extension is simply absent rather than guarded per event. **Known
limitation:** the same rule disables image upload behind an editable share
link, because an anonymous share-link editor has no workspace membership and
the image endpoint requires an authenticated caller.

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

The toolbar's **Foldout** button (issue #756) inserts the skeleton at the
caret and leaves it between `<summary>` and `</summary>`. It is a plain
insert, not a toggle, because foldouts nest. The tags are written flush left:
`markdown-it`'s indented-code rule runs *before* the disclosure rule, so a
four-space-indented `<summary>` would render as a code block —
`preview.test.ts` renders the command's own output to keep the two in step.
The same group adds **Quote** (line-wise `> ` toggle over the selection) and
**Code block** (fences the selection, or opens an empty fence).

Rendering is deliberately flat: no border, no background, and the prose-sm
paragraph margin on the container, so a foldout sits on the same vertical
grid as ordinary text and is marked only by the disclosure triangle. Every
non-summary child is indented by `margin-left`, so the folded body reads as a
child of the summary and nesting compounds the indent. `margin-left` rather
than `padding-left` because typography's rules come through `:where()` and
carry no specificity — a padding override would replace a nested list's
`padding-inline-start`.

#### Sized images (`<img width>`) — shipped (issue #973)

Markdown has no image-sizing syntax — CommonMark's image is only
`![alt](src "title")` and GFM adds nothing — so a pasted Retina screenshot
filled the preview pane and a 32px icon stayed tiny, with no escape hatch.
What people actually write (and what GitHub renders) is raw HTML:
`<img src="drawing.jpg" alt="drawing" width="200" />`, which the preview's
`html: false` posture escaped to literal text.

`packages/notes/src/view/img-plugin.ts` applies the same narrow-allowlist
trick as the disclosure plugin above, one tag instead of two: an **inline**
markdown-it rule (registered before `html_inline`, the rule that would
otherwise own a tag-opening `<` and is inert under `html: false`) recognizes
`<img …>` and accepts only four attributes — `src` (required), `alt`,
`width`, `height`. Dimensions must match `^\d+%?$`, so nothing that could
carry CSS gets through, and `src` goes through markdown-it's own
`normalizeLink` + `validateLink`, the same gate the `![]()` path uses.
Attribute order, `"`/`'`/unquoted values, and `>` vs `/>` all parse.

Two decisions worth keeping:

- **It pushes a normal `image` token, not a bespoke one.** markdown-it then
  escapes the attribute values it emits, and `preview.ts`'s existing image
  rule (`loading="lazy"` / `decoding="async"`) applies to HTML-written images
  for free. The renderer writes the rendered children into the `alt` slot, so
  the token must always carry an `alt` attribute (a missing one indexes
  `attrs[-1]` and throws) and must carry the alt text as a child `text` token
  — the attribute's value is literal text, not markdown.
- **Anything outside the allowlist makes the rule decline** rather than drop
  the offending attribute: the tag falls through to the `html: false`
  pipeline and is escaped as text, which is today's behavior and tells the
  author the shape is unsupported. Silently ignoring `style="width:200px"`
  would render at intrinsic size with no hint why. Dropping it would be
  equally safe — the plugin only ever emits its own four attributes — so this
  is a legibility call, not a security one.

One CSS caveat: Tailwind preflight ships `img { max-width: 100%; height:
auto }`, and an author-CSS declaration outranks the presentational hint an
HTML dimension attribute produces. `width` is unaffected (preflight sets no
`width`) and `max-width` still keeps an oversized value inside the column, so
the issue's case works; a lone `height` contributes the intrinsic aspect ratio
next to `width` but does not force a hard height. GitHub's markdown CSS
deliberately declares no `height` for this reason. Overriding preflight for
preview images was left alone as a separate call.

An editor-side resize handle, and the markdown-syntax alternatives
(`=200x` / `{width=200}` / `![alt|200]`), remain unimplemented; the HTML form
is the one users paste.

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
  insertion of note-derived markup, and note content is untrusted
  (a collaborator or editor-role share-link visitor authors it, someone else
  renders it), so the `html: false` "no raw note HTML" rule is not delegated to
  the engine alone: (1) `securityLevel: 'strict'` with `startOnLoad: false`
  sanitizes labels and ignores `click` directives, an extended `secure` key
  list pins the theming keys — plus `dompurifyConfig`, which would otherwise
  relax mermaid's *own* label sanitizer, and the `flowchart`/`class` sections
  whole — and `htmlLabels: false`, set at the root **and** on those two
  sections, makes a node label SVG text rather than an HTML subtree
  (issue #721, below);
  (2) `prepareFenceSource()` bounds and cleans the fence body before the
  engine sees it: it caps the length at mermaid's own `maxTextSize` default
  (the engine checks that *inside* `render()`, i.e. after every scan and strip
  here has already run on the whole body), refuses a source that carries a
  fetch (below), and `stripConfigDirectives()` removes both config carriers —
  `%%{...}%%` directives and leading front matter — so a note cannot push
  `themeCSS`/`themeVariables` into the
  document-scoped `<style>` mermaid emits inside the SVG. It reuses mermaid's
  own `directiveRegex`/`frontMatterRegex` (the closing `}%%` is *optional* for
  the engine), drops front matter unconditionally, and **iterates** rather than
  running once — the front-matter pattern is `^`-anchored, so a single pass
  *manufactures* a carrier the source did not have: removing the first `---`
  block promotes the second into the leading position mermaid parses, and the
  engine extracts front matter *before* it removes directives, so a `---` block
  a directive precedes is one mermaid would never have read (directive removal
  promotes a directive the same way, by joining the text around a match). The
  iteration is **bounded**, not a fixpoint, and the bound is load-bearing: each
  pass rescans the whole body but is only guaranteed to remove one leading
  front-matter block, so an unbounded loop over a fence of stacked minimal
  blocks is quadratic — a stored main-thread freeze for every reader. A source
  still changing after the last pass is refused instead. Dropping front
  matter unconditionally matters because `secure` pins only top-level
  keys — a carrier the strip under-recognizes still delivers a
  nested override — and the copies are version-pinned
  (`MERMAID_CARRIER_PATTERNS_VERSION`, asserted against the installed
  `mermaid` in `preview.test.ts`) so an upgrade under the caret range cannot
  move the engine's patterns out from under them unnoticed; (3) `sanitizeSvg()`
  runs the engine's output through **DOMPurify** (allowlist, SVG + SVG-filter +
  HTML profiles, fetch-capable tags forbidden) and returns a
  `DocumentFragment` that is inserted as nodes — never re-serialized and
  re-parsed, so the tree that was inspected is the tree that reaches the
  document. Its `ALLOWED_URI_REGEXP` is DOMPurify's **default** with the scheme
  list narrowed to `http(s)`/`mailto:` (`#` falls out of the default's own
  non-letter branch): the default's trailing "not a URI at all" branches must
  stay, because DOMPurify applies that regexp to every allowed attribute value
  that is not `data-*`/`aria-*`/URI-safe — dropping them strips `d`,
  `transform`, `viewBox`, `width`, `fill` and renders every diagram empty.
  CSS is the one thing DOMPurify does not inspect, so a `<style>` element or
  `style` attribute whose text (raw *or* CSS-escape-decoded) contains
  `@import`, an off-page `url()` or another fetch function is dropped whole,
  as is any `<style>` with an element child — the browser builds a sheet from
  *child text content*, so an element child splits a construct past a
  `textContent` check. DOMPurify is loaded next to the engine
  (`import('dompurify')`), which costs no bytes a diagram was not already
  paying for — mermaid depends on it. `securityLevel: 'sandbox'` (mermaid's own
  advice for untrusted input) is deliberately not used — it iframes every
  diagram, which breaks sizing, text selection and the light/dark surface.
  That trade is knowingly taken, and layer 3 is **not** an equivalent
  substitute: outside sandbox mode the engine appends its own `d<id>` host div
  to `document.body` and lays the diagram out there before serializing, so its
  output is briefly in the live document ahead of our pass. Layer 3 governs
  what *persists*; it is not a fetch boundary.
- **Why `htmlLabels: false` (issue #721).** That layout window was a real
  disclosure while node labels were HTML: `A["<img src=…>"]` is a
  `<foreignObject>` subtree the engine parses into the live document to measure
  it, so the URL was fetched — handing the note's author every reader's IP,
  User-Agent and reading time — while `sanitizeSvg()`, running strictly
  downstream, still removed every `<img>` from what persisted. A request
  already sent is out of reach of `FORBID_TAGS`/`ALLOWED_URI_REGEXP`; the same
  went for a `background:url(…)` in a label's inline `style`. The exposure was
  a fetch, not script execution — `securityLevel: 'strict'` had mermaid run
  every label through its own DOMPurify pass first, which strips `on*`
  handlers, so an `onerror` on that `<img>` never ran. With HTML labels off
  there is no label subtree to lay
  out and the payload measures and renders as literal SVG text. The cost is
  HTML *styling* inside a label — no bold/italic or markdown formatting;
  `<br/>` still breaks the line, since mermaid splits SVG-text labels on it —
  and
  the key is pinned in `secure` (root and per-diagram section) and its carriers
  stripped so a note cannot turn it back on. It is asserted against the *real*
  engine, not just the config we pass: one case runs the production config
  through mermaid under jsdom (a stubbed `getBBox` is enough for its layout
  pass) and asserts the serialized output has no `foreignObject`, with a
  control case showing the same source does emit one at the engine's default.
  A restrictive `img-src` CSP would fix the whole class app-wide
  and remains the better long-term answer; the repo has no CSP today. Layer 3
  keeps its HTML profile and `foreignobject` regardless, because several
  diagram types (venn text nodes, architecture icons, kanban, sequence) emit a
  `foreignObject` with no `htmlLabels` guard.
- **Why the source is refused, not just sanitized.** `htmlLabels: false` closes
  the label path and nothing else, so layer 2 also refuses a fence body that
  carries a fetch at all (verified against the pinned `mermaid@11.16.0`
  build): a fetch-capable raw HTML tag (`<img>`, `<iframe>`, `<use>`, …),
  `img:` shape metadata — `A@{ img: "https://…" }` reaches mermaid's image
  shape, which does `new Image(); img.src = node.img; await img.decode()` and
  appends an SVG `<image href>` to the live layout host, with no label
  involved — or an external CSS `url()`/`@import`. The unguarded-`foreignObject`
  diagram types above are why the raw-tag rule matters: their labels go through
  mermaid's own `sanitizeText()`, whose DEFAULT DOMPurify allowlist permits
  `<img src>`. Refusing costs nothing a reader could ever have seen, since
  layer 3 forbids every one of those in what persists (`FORBID_TAGS` covers
  `img`/`image`, the CSS check covers `url()`); the only thing it removes is
  the request. The block keeps its source visible with a message, the way an
  unparseable diagram does. The rule is a tag-name list rather than "no raw
  HTML" so `<br/>`, `<b>` and the class-diagram arrows (`<|--`, `<-->`) stay
  usable, and entity-encoding is not a way around it — an HTML parser turns
  `&#60;img>` into text, not an element.

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

#### Per-line author gutter — shipped (issue #814)

A `git blame`-style gutter left of the line numbers, showing who last edited
each line. Consecutive lines by one author collapse to a single label. It is
**off by default** and toggled from the view menu, so a reader who never turns
it on gets a note identical to before — same layout, same line width, and no
gutter extension in the editor at all.

The toggle is **display only**. Recording is unconditional: every attached
client stamps the text it writes, whether or not its user has the gutter
switched on. That asymmetry is deliberate, and it is what makes the gutter
answer the question it exists for — authorship is a property of the *note*, not
of the reader, and a per-writer recording switch would mean someone who turns
the gutter on sees blank labels for every line written by collaborators who did
not, which for most notes is every line.

The disclosure that follows is real: unlike the caret label it is copied from —
presence, which evaporates on detach — an author attribute goes into
`root.content` and stays for the life of the note, readable by anyone who can
read the note at all, including anonymous viewer-role share-link visitors. It is
the same display name those readers already see on the caret, and the view menu
says in as many words that names are recorded and who can see them. Nothing is
erased retroactively: rewriting a shared document's runs to strip a name is not
something one client may do to it.

Both `NotesView` mounts pass the preference — the authenticated note page from
its view menu, the share-link page (which has no menu) from the same
per-browser `wafflebase:notes:showAuthors` value, read once at mount.

Authorship rides on the existing `root.content` `Text` as **per-run
attributes**, written by `YorkieNoteStore.editText`:

```ts
root.content.edit(from, to, insert, { a: <author name>, t: <epoch ms> });
```

No new root field, so the CodePair-compatible `{ content: Text }` schema is
untouched and a reader that ignores attributes still sees the identical string.
`Text.values()` reads the runs back as `NoteAuthorSpan[]` (`NoteStore.getAuthorSpans`),
which the engine turns into per-line labels: a line's author is the one who
wrote the run with the newest `t` overlapping it — literally "the author of the
line's most recent edit". Attributes survive undo, because Yorkie's reverse ops
restore the nodes that carried them.

Consequences that follow from that choice, all of them intended:

- **No migration, no backfill.** Text written before this shipped carries no
  attributes, reports `author: null`, and renders blank rather than a wrong
  name. Attribution accrues from the first edit after the feature lands.
- **Anonymous stays anonymous.** The name comes from the client's own presence
  `name`, which anonymous share-link editors already attach as `"Anonymous"`;
  an empty name renders as "Anonymous" too. Blame is a reading aid, not an
  audit trail — see the trust boundary below.
- **Pure deletions record nothing** — they insert no run to attribute.
- **Storage.** Roughly 30 bytes of attribute JSON per inserted run. Runs are
  already the CRDT's unit of storage, so this is a constant factor on existing
  per-run overhead rather than a new structure, and it is bounded by edit count,
  not note length. Retention (how far back authorship is kept) is deliberately
  unbounded for now — the issue's open question, revisited if real notes show
  it mattering.

Two CodeMirror ordering constraints shape `packages/notes/src/view/blame-gutter.ts`,
and both are load-bearing:

1. Gutters render in `activeGutters` facet order, so the gutter extension is
   listed **before** `basicSetup` (which contributes `lineNumbers()`) to sit to
   its left.
2. That also fixes the shared gutter `ViewPlugin` *before* `noteSync` in the
   plugin order, so at paint time a local edit has not reached the store yet.
   The labels therefore come from a second plugin listed **after** `noteSync`,
   published through a per-view map — deliberately not via `view.plugin(...)`,
   which would force that plugin's pending update to run early and hand it the
   same stale model. When the recomputed labels differ, it dispatches one empty
   annotated transaction that the gutter's `lineMarkerChange` picks up, so the
   gutter converges in two transactions and stays idle otherwise.

##### Trust boundary — attribution is self-reported

The gutter answers "who most likely wrote this line", not "who provably wrote
it", and the difference is load-bearing:

- The name comes from the writing client's own presence, and the attributes live
  inside the CRDT that every attached client may write. Yorkie validates nothing
  inside a change, and the backend never sees a note edit at all — its auth
  webhook authorizes a docKey and a verb, not content. A client speaking to
  Yorkie directly can therefore claim any name on any run, including restyling a
  run it never wrote.
- So blame is **never** an audit trail and **never** an input to an access
  decision. Nothing reads `getAuthorSpans()` except the gutter's label
  computation.
- What is enforced is the blast radius of a forged attribute:
  - **Time.** `YorkieNoteStore.getAuthorSpans()` discards a `t` further ahead
    than clock skew explains (5 minutes) instead of clamping it. Clamping was
    not a bound: `Date.now()` is re-read on every call, so a run claiming the
    year 3000 clamped to "now" stayed the newest run on its line forever — which
    is exactly the outranking the clamp was meant to prevent. Discarded, it
    reads as unknown (`0`) and loses to every real edit; within skew it is still
    clamped to now, so the most it can win is a tie that document order breaks.
  - **Name.** Both places a self-reported name reaches the DOM — the gutter
    label and the peer caret label — run it through
    `sanitizeDisplayName()` (`packages/notes/src/display-name.ts`), which strips
    invisible and direction-changing characters (controls, format characters,
    line/paragraph separators, and the invisible-but-not-`Cf` code points that a
    `\p{Cc}\p{Cf}` strip alone misses), folds exotic spaces, and caps at 64
    characters. It lives at the render boundary rather than in one store, so no
    store implementation has to be trusted to have cleaned its own output.
  - **Color.** The peer caret's `color` is presence too, and unlike a name it
    is not text content: it is interpolated into a `style` *attribute*, which
    the browser parses as a declaration list, so a color carrying `;` stops
    being a color and becomes whatever declarations its author chose (`position:
    fixed; inset: 0; background-image: url(…)` — a full-viewport overlay and an
    outbound request on every other viewer's screen). `sanitizePeerColor()`
    (`packages/notes/src/view/remote-selection.ts`) therefore *recognizes*
    rather than escapes: `#hex`, a bare CSS keyword, or an
    `rgb()/rgba()/hsl()/hsla()` whose arguments are numbers — the shapes
    `noteUserColor` actually produces — pass, and anything else is replaced with
    a neutral fallback. There is no character to neutralize here, only a value
    to refuse.
  - The gutter's hover title says "(self-reported)" for the same reason.
- Verified provenance would need the backend to sign each run's authorship, or
  Yorkie to expose a change's server-assigned actor per run. Both are out of
  proportion for a reading aid; if authorship ever needs to be relied on, that
  is the work, not a tightening of this path.

#### List controls and interactive checkboxes — shipped (issue #754)

Three pieces, all line-level rewrites of the markdown source — there is no
block model to keep in step, and every path lands as an ordinary CodeMirror
transaction, so sync, undo, and presence apply unchanged:

- `packages/notes/src/view/checkbox-input.ts` — an `inputHandler` that inserts
  the missing `- ` when the user types the space after a line-leading `[ ]` /
  `[x]`. Normalizing the *source* (rather than teaching the preview to render
  bare boxes) keeps the note canonical GFM, so it stays a checklist wherever
  else it is read.
- `packages/notes/src/view/list-commands.ts` — the toolbar's bullet / numbered
  / checkbox toggles, indent, outdent, and the `computeListState()` reader that
  drives their pressed and disabled states. Every command applies to all lines
  the selection covers, blank lines excepted, and rewrites only each line's
  marker prefix so the caret keeps its place in the text. One indent step is
  the width of the item above's content column, not a fixed two spaces —
  `1. ` needs three columns before a child nests under it — and indenting is
  refused when there is no item above at the same level to nest under (the
  first item of a list has no parent to join).
- `preview.ts` — task checkboxes render enabled and each task `<li>` carries
  its source line (`data-source-line`, from the markdown-it token map); a
  delegated click anywhere on the item flips that line. The preview never
  updates its own DOM: the source change re-renders it, so the box always
  shows what the note says even when a peer ticks it concurrently. A read-only
  mount passes no callback and its checkboxes are re-disabled after each
  render. The `<label>` wrapper `markdown-it-task-lists` can add is
  deliberately off — it would forward its click to the checkbox inside it and
  report the same tick twice.

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
