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
- Tests: `packages/frontend/tests/app/docs/docs-page-setup-dialog.test.tsx`,
  `docs-export-button.test.tsx`, `docs-format-painter.test.tsx`,
  `packages/docs/test/format-painter-api.test.ts`.
</content>
</invoke>
