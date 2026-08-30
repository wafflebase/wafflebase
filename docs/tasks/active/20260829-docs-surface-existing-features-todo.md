# Surface shipped Docs capabilities that have no UI

Four Docs features are complete in the engine and unreachable from the app.
This task is pure wiring: no new document behaviour, no new file formats, no
new model fields.

## Problem

| Capability | Where it already lives | Reachable today |
| --- | --- | --- |
| Page setup | `PageSetup` in `packages/docs/src/model/types.ts`; `DocStore.setPageSetup` (`store.ts:28`, `memory.ts:98`, `yorkie-doc-store.ts:2710`) | Only by dragging the ruler's margin handles, which cannot change paper size or orientation at all |
| Markdown export | `serializeMarkdown` (`packages/docs/src/serialize/markdown.ts:34`) | CLI only (`wafflebase docs content --format md`) |
| Plain-text export | `serializeText` (`packages/docs/src/serialize/text.ts:34`) | CLI only |
| Format painter | `TextEditor` `styleBuffer` + `captureFormatAtCursor` (`text-editor.ts:997,1137`) | Keyboard only (`Mod+Shift+C` / `Mod+Alt+V`) |

`docs/design/docs/docs-pagination.md:33` lists "Page setup UI (modal dialog,
side panel) — deferred to frontend integration" as an explicit non-goal of the
pagination work, so the dialog is the intended shape.

## Plan

1. **Engine: expose page setup on `EditorAPI`.** The dialog cannot call
   `docStore.setPageSetup()` directly — a page-setup write also needs
   `docStore.snapshot()`, `doc.refresh()`, layout invalidation and a repaint,
   which is exactly what the ruler's `onMarginChange` handler already does
   (`editor.ts:1967`). Add `getPageSetup()` / `setPageSetup()` to `EditorAPI`
   routing through that same sequence, and let the ruler handler reuse it so
   there is one write path, not two.
2. **Engine: expose the format painter on `EditorAPI`.** Lift the two
   keyboard-handler bodies into `TextEditor.copyFormat()` /
   `pasteFormat()` (plus `clearCopiedFormat()`, `hasCopiedFormat()` and an
   `onCopiedFormatChange()` listener so a toolbar toggle can mirror keyboard
   use), and have the `Mod+Shift+C` / `Mod+Alt+V` cases call them. The
   shortcuts must keep behaving exactly as they do now.
3. **Frontend: Page Setup dialog.** `docs-page-setup-dialog.tsx` built on the
   shared `Dialog` primitive (same idiom as `miro-import-dialog.tsx`), opened
   from a docs-toolbar button. Fields = exactly what `PageSetup` carries:
   paper size (Letter / A4 / Legal), orientation, and the four margins.
   Margins are entered in inches (the model stores CSS px at 96 dpi, so
   1 in = 96 px exactly), matching how a word processor states them.
4. **Frontend: Markdown + plain-text export.** Two more entries in
   `docs-export-button.tsx`, going through the same
   `runExport` → `downloadBlob(safeFilename(...))` path as DOCX and PDF.
5. **Frontend: format painter toggle** in `docs-formatting-toolbar.tsx`,
   modelled on the shipped slides `FormatPainterButton`.

## Acceptance criteria

- [x] Page Setup dialog reachable from the docs toolbar; changes paper size,
      orientation and all four margins; round-trips the current setup when
      reopened; one undo step reverts it
- [x] Dialog exposes every `PageSetup` field and no field the model lacks
- [x] Export menu offers Markdown (`.md`) and plain text (`.txt`) with the
      right MIME types, next to Word and PDF
- [x] Format painter toolbar toggle shows pressed state while a format is
      held, including when the format was picked up with `Mod+Shift+C`
- [x] The keyboard shortcuts behave exactly as before
- [x] `pnpm verify:fast` green

## Non-goals

- Word count — there is no `wordCount` anywhere in the engine, so it is a
  feature to build, not a feature to surface. Out of scope here.
- Per-section page setup, custom paper sizes, a cm/mm unit toggle.
- A pointer-driven paint mode for the format painter (the docs engine has no
  such mode; slides' `beginFormatPaint` pointer flow is a different design).

## Review

- Engine: `packages/docs/src/view/editor.ts` (+`EditorAPI` page-setup and
  format-painter members), `packages/docs/src/view/text-editor.ts` (format
  painter lifted out of the key handlers).
- Frontend: `packages/frontend/src/app/docs/docs-page-setup-dialog.tsx` (new),
  `docs-formatting-toolbar.tsx`, `docs-export-button.tsx`,
  `text-actions.ts` (new), `export-utils.ts` (`safeFilename` extensions).
- Tests, engine: `packages/docs/test/view/editor-page-setup.test.ts` (new),
  `packages/docs/test/view/editor-format-painter.test.ts` (new),
  `packages/docs/test/view/editor-read-only.test.ts` (extended: the two new
  mutating `EditorAPI` methods, plus `TextEditor.pasteFormat()`'s own guard),
  `packages/docs/test/serialize/markdown.test.ts` (extended: URL safety).
- Tests, frontend: `packages/frontend/tests/app/docs/docs-page-setup-dialog.test.tsx`,
  `docs-export-button.test.tsx`, `docs-format-painter-toggle.test.tsx`,
  `text-actions.test.ts` (all new).

## Review follow-ups

Raised in review on the branch and fixed here:

- The format painter carried the structural inline keys (`image`,
  `pageNumber`, `href`) in its buffer, so a pick-up whose caret sat on an
  image or a link stamped that image / destination onto every run it was
  pasted over. `NON_PAINTABLE_INLINE_KEYS` in `text-editor.ts` strips them.
- `serializeMarkdown` wrote `href` / `image.src` into the downloaded file
  with no scheme filter, unlike the PDF exporter beside it. Both are now
  gated: an unsafe link degrades to its text, an unsafe image source to the
  serializer's existing `[image]` placeholder. A `data:image/...` source is
  still emitted — that is what `inlineImages` is for.
- `TextEditor.pasteFormat()` gained the `readOnly` guard every sibling
  programmatic mutator carries; read-only no longer depends on the
  `EditorAPI` allowlist alone.
- The page-setup seeding test asserted a label that always renders, so
  nothing verified that orientation or paper size were seeded from the
  document. It now reads the checked radio and the selected paper size
  against two differently-configured documents, and pins the Apply round
  trip.
- Two smaller test gaps closed: the toolbar toggle's cancel-with-no-selection
  path, and that `notifyStyleApplied` fires only when the paste wrote.

Recorded as known limitations rather than fixed here: `safeFilename` not
stripping control/bidi characters or a leading dot (pre-existing, identical
for the already-shipped `.pdf`/`.docx`), the `editor.focus()` / Radix
focus-restore ordering, the two-press vs one-press painter semantics against
slides, the mobile-width toolbar calculation, and an automated completeness
check for the read-only `MUTATING_METHODS` allowlist.

## Second review round

- **URL gate was a parser differential.** `isSafeUrl` validates what WHATWG
  `new URL()` makes of the string — and that parser *deletes* tab, LF and CR
  before it reads the scheme — while the serializer wrote the raw string. A
  newline in an `href` or an image `src` therefore passed the gate and then
  closed the Markdown link destination, landing arbitrary Markdown or raw HTML
  in the exported `.md`. `UNEMITTABLE_URL_CHARS` in
  `packages/docs/src/serialize/markdown.ts` now refuses whitespace and C0/C1
  controls before `isSafeUrl` runs, on both the `href` path and the image
  path (including the `data:image/...` branch, which bypasses `isSafeUrl`).
- **`import-export.md` claimed Markdown export preserves "code".** The Docs
  model has no code block and no inline-code style, so nothing could. The
  whole preserved/lossy pair was re-derived from `serializeMarkdown`.
- **The aliasing test could not fail.** `editor-page-setup.test.ts` mutated the
  returned setup and compared it with `DEFAULT_PAGE_SETUP`; under aliasing the
  mutation hit both sides. It now reads a fresh `getPageSetup()` against
  literal values and asserts the module constants are untouched.
- **`writePageSetup` now validates.** Geometry that closes the content box (or
  is negative / non-finite) throws a `RangeError` before anything is
  snapshotted, measured against the effective page box. The rule was
  previously stated only in the React dialog and, more strictly, in the ruler.
- Coverage added: the paper-size `Select` and its `CUSTOM` sentinel; the
  paste-before-clear ordering of the toolbar toggle; a two-undo assertion so
  "one undo step" fails on a double snapshot; the failure toast the export
  test's own file comment advertised.

## Third review round

- **`getStore()`'s guard claimed more than it delivers.** The proxy added last
  round guarded `setPageSetup` two ways — geometry *and* a read-only drop —
  and its comment read as though the store handle were guarded in general. It
  is not: the proxy forwards ~30 other `DocStore` mutators untouched,
  `getDoc()` hands out a `Doc` that writes straight to the unwrapped store,
  and `getPrototypeOf` / `defineProperty` are not trapped.
- **Scoped, not removed.** The read-only drop stays, because deleting working
  protection to make a comment true is the wrong direction and it costs one
  line to make the two doors to that single write behave identically. What
  changed is the claim: `packages/docs/src/view/editor.ts` now names the
  wrapper `pageSetupGuardedStore`, states that it is defence in depth over one
  method and explicitly **not** an access-control boundary, and points at
  **issue #989** — which owns read-only across `getStore()` / `getDoc()` and
  predates this branch (on `main` neither accessor is in `MUTATING_METHODS`).
  The `MUTATING_METHODS` comment carries the same pointer.
- **The proxy stayed, for a different reason.** Its justification is now
  forwarding totality, not guarding totality: exactly one member is replaced,
  and a hand-written delegate would need a new line per interface method just
  to remain a working store. That is also what answers "nothing keeps the
  guard in sync as `DocStore` grows" — naming one method means a method added
  tomorrow is forwarded, never silently half-guarded, so there is no sync
  obligation to pin. Memoized bound members and the `set` trap are unchanged.
- **The limit is now executable.** `editor-read-only.test.ts` gains a test
  asserting that another store mutator (`insertText`) *does* write through
  `getStore()` in read-only, tagged `#989`, so the wrapper cannot be misread
  as read-only enforcement. It is written to fail — and be inverted, not
  deleted — when #989 lands.

## Fourth review round (closing)

- **The dialog could produce an uncaught `RangeError`.** Making
  `EditorAPI.setPageSetup` throw (third round) left the Page Setup dialog's
  own margin check looser than the floor the setter asserts on: the dialog
  refused `left + right >= pageWidth`, the assert refuses
  `left + right > pageWidth - MIN_CONTENT_PX`. In the band between them a form
  the dialog accepted — Apply enabled, no error shown — reached the throwing
  setter, and the exception escaped a React event handler and unmounted the
  editor. Reachable whenever the effective page box is fractional (the dialog
  rounds every typed margin to a whole pixel), which `resolvePageSetup`
  preserves for any finite positive paper dimension, so a collaborator's CRDT
  write or a CLI-set geometry is enough. Fixed by importing the engine's
  `MIN_CONTENT_PX` — now re-exported from `@wafflebase/docs` — instead of
  restating the floor. Failing tests first
  (`docs-page-setup-dialog.test.tsx`: two sliver cases, one per axis, plus a
  "still accepts the widest margins the engine accepts" test so the fix
  cannot be a blanket tightening); each mutation-checked.
- **Apply is defensive too.** Not instead of that check: `setPageSetup` is a
  public engine API whose floor moved once already, and the dialog's check is
  a second implementation of it, not a proof of exhaustiveness. A throw is
  caught and shown verbatim in the same `role="alert"` line the form
  validation uses, the dialog stays open, nothing is applied, and any change
  to the form clears it. Nothing is swallowed — two tests pin the surfaced
  message and the clear.
- **`docs-pagination.md` still described `resolvePageSetup` as plain
  defaulting.** It is now the sanitisation boundary every consumer reads
  through. The doc describes what it does (per-field fallback, finite/positive
  dimensions, proportional margin fit to `MIN_CONTENT_PX`, defensive copy) and
  why it clamps rather than throws: the geometry reaching it is a remote
  peer's or an importer's, with no caller to report to, and a peer must not be
  able to make this replica's document un-openable. The deliberate write path
  still throws, on the same constant.
- **`docs-pdf-export.md` still described the Export dropdown as DOCX/PDF.**
  Corrected to the four entries that ship, with `text-actions.ts` added to the
  file listing. The rest of that document's export surface was re-checked: the
  "Print Preview" non-goal and the lazy-import note are still accurate, and
  the stale "the formatting toolbar's Export dropdown" phrasing had already
  been removed — there is one export surface, in the docs header.

Explicitly **not** done in this round, and why:

- **#989** (read-only across `getStore()` / `getDoc()`, including the proxy's
  `getPrototypeOf` / `defineProperty` escapes) and **#990** (the PDF link
  annotation's unescaped href in a PDF literal string, from #168) — both
  filed, both predate this branch, both ruled out of scope.
- **`resolvePageSetup` has no minimum *page* size** (a 1×1 px paper survives
  it). Pre-existing and by design: the function's floor is on the content box,
  and a page too small to be useful is still a page that lays out.
- **The backend `docs-content` PUT validator does not check `pageSetup`.**
  Pre-existing; this branch added no backend validation and no new write path
  there. Anything it stores meets `resolvePageSetup` on read, which is the
  boundary that has to hold for untrusted geometry.
