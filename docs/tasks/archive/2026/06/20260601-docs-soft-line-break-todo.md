# Docs: soft line break (`\n`) as in-paragraph wrap

**Goal:** Make `@wafflebase/docs` layout treat `\n` inside inline text
as a forced line wrap inside the same paragraph (Word-processor
Shift+Enter semantics, OOXML `<a:br/>`).

**Symptom (real-world trigger):** Slide 5 of the "Yorkie, 캐즘 뛰어넘기"
deck has `<a:r>Tier 3</a:r><a:br/><a:br/><a:r>원본 ...</a:r>` — two
soft line breaks between "Tier 3" and "원본 로컬에 저장". The slides
importer translates each `<a:br/>` into an inline `text: '\n'`, but
docs `layoutBlock` treated `\n` as just another glyph: `splitWords`
only split on space, line-wrap only fired on width overflow, so the
break silently disappeared. Slide 5 rendered as one long line.

**Architecture:** Soft break stays in the model as a one-character `\n`
in inline text (cursor / selection / find-replace / undo all unchanged
— `\n` is just at character offset N). Layout side recognises the
character and forces a line flush. Stored Block structure is identical
across plain text and softbreak-containing text — only the LAYOUT
result differs.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/docs/src/view/layout.ts` | `MeasuredSegment.softBreak`, `splitWords` splits on `\n`, `layoutBlock` flushes on softBreak segment, trailing empty line when block ends on `\n` | Modify |
| `packages/docs/src/view/paint-layout.ts` | `renderRun` early-return for `\n` runs | Modify |
| `packages/docs/src/view/table-renderer.ts` | Inner table-cell run loop skips `\n` | Modify |
| `packages/docs/test/view/layout.test.ts` | 6 new tests for the soft-break paths | Modify |

## Tasks

- [x] **Task 1:** `MeasuredSegment.softBreak?: true`, `splitWords` splits on `\n`, `measureSegments` emits 0-width softBreak segment.
- [x] **Task 2:** `layoutBlock` appends 0-width `\n` run (cursor / offset continuity) and flushes. `lastWasSoftBreak` tracks trailing-`\n` so a final empty line is added.
- [x] **Task 3:** `renderRun` (`paint-layout.ts`) and table-renderer inner loop skip `\n` runs — fillText / underline / strike all bail out.
- [x] **Task 4:** Tests — single `\n`, slide-5 two-`\n` empty-line case, trailing `\n`, charStart/charEnd continuity, `textIndent`-only-on-first-line, soft-break vs word-wrap composition.
- [x] **Task 5:** `pnpm verify:fast` green (all 240 + 56 = 296 test files relevant; 1531 tests total).

## Notes

- Pagination already operates per `LayoutLine`; a soft break expands a
  block into more lines, which pagination handles transparently.
- Image runs are unbreakable; soft break doesn't apply to them. The
  importer never emits `\n` on an image inline anyway.
- Editor Shift+Enter binding to insert `\n` is **out of scope** —
  currently the PPTX importer is the only producer. Plain-text paste
  splits on `\n` into separate blocks today; that path stays unchanged.
- DOCX export `<w:br/>` mapping and PDF export `\n` handling are
  follow-up work flagged for a separate task.
