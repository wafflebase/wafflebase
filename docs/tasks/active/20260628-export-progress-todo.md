# Export Progress Reporting — TODO

Design: `docs/design/export-progress.md`

Show incremental progress (Sonner toast, import-style) for large exports and
keep the UI responsive by yielding the event loop between work units.

## Plan

### Packages: yield util + onProgress callbacks
- [x] `slides/src/export/yield.ts` — `yieldToPaint()` (MessageChannel + setTimeout fallback)
- [x] `docs/src/export/yield.ts` — same helper (local copy)
- [x] Slides PDF (`slides/src/export/pdf.ts`) — add `onProgress`, emit per slide, `await yieldToPaint()`
- [x] Slides PPTX (`slides/src/export/pptx/index.ts`) — add `onProgress`, emit per slide, yield
- [x] Docs PDF (`docs/src/export/pdf-exporter.ts`) — add `onProgress`, emit per page, yield
- [x] Docs DOCX (`docs/src/export/docx-exporter.ts`) — add `onProgress`, emit per image fetch (mirror import)

### Frontend: toast wiring
- [x] `export-utils.ts` — `updateExportToast(id, title, done, total, unit)` helper
- [x] `docs-export-button.tsx` — thread `onProgress` into DOCX + PDF actions
- [x] `slides-export-button.tsx` — thread `onProgress` into PDF action
- [x] `docx-actions.ts` / `pdf-actions.ts` (docs) — accept + forward `onProgress`
- [x] `pdf-actions.ts` (slides) — accept + forward `onProgress`
- [x] success → `toast.success`, failure → existing `toast.error`

### Tests + verify
- [x] Unit test each exporter: `onProgress` starts (0,total), monotonic, ends (total,total)
- [x] Rebuild producer packages (docs/slides) before frontend typecheck
- [x] `pnpm verify:fast` — green
- [ ] Manual smoke in `pnpm dev`: large deck/doc, toast counts up, UI responsive (human to verify)

## Review

Executed via subagent-driven development across 5 tasks (one commit each), TDD
throughout. Per-task spec+quality reviews all came back ✅/Approved; final
whole-branch review (Opus) returned **READY TO MERGE** with no Critical or
Important findings.

**Shipped:**
- `yieldToPaint()` (MessageChannel macrotask) in both docs + slides packages.
- `onProgress(done, total, phase)` on slides PDF/PPTX, docs PDF/DOCX exporters
  — optional, behavior unchanged when omitted (CLI/tests).
- Import-style Sonner toast via shared `updateExportToast`, wired to the docs
  (PDF/DOCX) and slides (PDF) export buttons. Phase string doubles as the unit
  label ("12 / 50 slides").

**Scope note:** PPTX got library-level `onProgress` but no toast — `exportPptx`
has no frontend trigger today.

**Known minor follow-ups (non-blocking):** dead `metadata` param on
`exportPdfAndDownload`; per-call `MessageChannel` allocation; loose test
assertions. See lessons file.

**Pending:** manual `pnpm dev` smoke (UI changed) before merge.
