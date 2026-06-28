# Export Progress Reporting — TODO

Design: `docs/design/export-progress.md`

Show incremental progress (Sonner toast, import-style) for large exports and
keep the UI responsive by yielding the event loop between work units.

## Plan

### Packages: yield util + onProgress callbacks
- [ ] `slides/src/export/yield.ts` — `yieldToPaint()` (MessageChannel + setTimeout fallback)
- [ ] `docs/src/export/yield.ts` — same helper (local copy)
- [ ] Slides PDF (`slides/src/export/pdf.ts`) — add `onProgress`, emit per slide, `await yieldToPaint()`
- [ ] Slides PPTX (`slides/src/export/pptx/index.ts`) — add `onProgress`, emit per slide, yield
- [ ] Docs PDF (`docs/src/export/pdf-exporter.ts`) — add `onProgress`, emit per page, yield
- [ ] Docs DOCX (`docs/src/export/docx-exporter.ts`) — add `onProgress`, emit per image fetch (mirror import)

### Frontend: toast wiring
- [ ] `export-utils.ts` — `updateExportToast(id, title, done, total, unit)` helper
- [ ] `docs-export-button.tsx` — thread `onProgress` into DOCX + PDF actions
- [ ] `slides-export-button.tsx` — thread `onProgress` into PDF action
- [ ] `docx-actions.ts` / `pdf-actions.ts` (docs) — accept + forward `onProgress`
- [ ] `pdf-actions.ts` (slides) — accept + forward `onProgress`
- [ ] success → `toast.success`, failure → existing `toast.error`

### Tests + verify
- [ ] Unit test each exporter: `onProgress` starts (0,total), monotonic, ends (total,total)
- [ ] Rebuild producer packages (docs/slides) before frontend typecheck
- [ ] `pnpm verify:fast`
- [ ] Manual smoke in `pnpm dev`: large deck/doc, toast counts up, UI responsive

## Review

(to fill in after implementation)
