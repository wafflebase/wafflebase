# IME Composing Underline (issue #342)

Design note: `docs/design/docs/docs-ime-composing-underline.md`
PR: #514 (implement in same PR, per maintainer request)

## Goal

Draw a thin solid underline under uncommitted (composing) IME text in the
docs editor; remove it automatically on commit / abort / blur. View-local
only — never persisted.

## Approach (per design note)

View-local `composing` marker on `LayoutRun` (NOT on the persisted
`Inline` / `InlineStyle`). `injectComposingInline` returns the injected
inline's index; `layoutBlock` tags runs whose `inlineIndex` matches;
`renderRun` paints a 1px solid underline in the resolved text color when
`run.composing` is set.

## Tasks (TDD)

- [x] `injectComposingInline` returns `{ inlines, composingIndex }`
  - [x] RED: index points at the spliced composing inline (mid-inline,
        boundary, end-of-block, empty-block); `-1` for empty text
  - [x] Update the one production caller (`layoutBlock`)
  - [x] Update existing `composing-injection.test.ts` call sites
- [x] `LayoutRun.composing?: boolean` field
- [x] `layoutBlock` tags composing runs
  - [x] RED: exactly the composing run(s) tagged; wrap → every sub-run
        tagged; no `ComposingContext` → none tagged
- [x] `renderRun` composing underline
  - [x] RED: composing run strokes 1px solid at `baselineY + 2` in text
        color; non-composing run without `style.underline` strokes none
- [x] Lifecycle: re-layout without composingContext → no tagged run → no
      underline (covered by the "none tagged" + renderRun tests)
- [x] `pnpm verify:fast` green
- [x] Manual smoke in `pnpm dev` (Korean IME shows underline, gone on commit)

## Out of scope (per note)

Underline color/style customization, composing background highlight,
changes to committed-text underline or composing measurement/commit.
