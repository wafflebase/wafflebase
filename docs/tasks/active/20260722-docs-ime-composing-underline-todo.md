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

- [ ] `injectComposingInline` returns `{ inlines, composingIndex }`
  - [ ] RED: index points at the spliced composing inline (mid-inline,
        boundary, end-of-block, empty-block); `-1` for empty text
  - [ ] Update the one production caller (`layoutBlock`)
  - [ ] Update existing `composing-injection.test.ts` call sites
- [ ] `LayoutRun.composing?: boolean` field
- [ ] `layoutBlock` tags composing runs
  - [ ] RED: exactly the composing run(s) tagged; wrap → every sub-run
        tagged; no `ComposingContext` → none tagged
- [ ] `renderRun` composing underline
  - [ ] RED: composing run strokes 1px solid at `baselineY + 2` in text
        color; non-composing run without `style.underline` strokes none
- [ ] Lifecycle: re-layout without composingContext → no tagged run → no
      underline (covered by the "none tagged" + renderRun tests)
- [ ] `pnpm verify:fast` green
- [ ] Manual smoke in `pnpm dev` (Korean IME shows underline, gone on commit)

## Out of scope (per note)

Underline color/style customization, composing background highlight,
changes to committed-text underline or composing measurement/commit.
