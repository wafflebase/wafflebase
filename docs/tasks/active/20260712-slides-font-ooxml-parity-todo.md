# Slides Font OOXML Parity — Phase A

Design: [docs/design/slides/slides-font-ooxml-parity.md](../../design/slides/slides-font-ooxml-parity.md)

Phase A closes two PPTX export round-trip losses for properties that
`InlineStyle` already models and the importer already reads. **No
shared-model field additions, and no Slides toolbar changes** — toolbar
exposure of strikethrough / highlight / super-subscript was prototyped
then intentionally reverted (see the design doc's "Deferred: toolbar
exposure"). Kept the export functionality only.

## A1 — superscript / subscript baseline export

- [x] PPTX export (`packages/slides/src/export/pptx/text.ts` `rPrXml`):
      emit `@baseline` — `superscript` → `baseline="30000"`,
      `subscript` → `baseline="-25000"` (inverse of the importer's sign
      test).
- [x] Round-trip test: super/subscript survives export → re-import.

## A2 — hyperlink export

- [x] Thread a `resolveHyperlinkRId` hook through `ElementXmlCtx` into
      the shape / text-box / table-cell serializers, then through
      `textBodyToXml` → `blockToXml` → `runToXml` → `rPrXml` (mirrors the
      image `resolveImageRId` pattern).
- [x] Emit `<a:hlinkClick r:id>` for runs with `href`; slide-local rel,
      `TargetMode="External"` (new `PptxWriter.addRel` external flag +
      XML-escaped target).
- [x] Export href policy `isExportableHref` (export-specific, NOT the
      import allowlist): require an explicit scheme, block only
      executable/local schemes; `http(s)`/`mailto`/`tel`/`sms`/`ftp` pass.
- [x] Round-trip test: hyperlink survives export → re-import (+ unit tests
      for emit / child-order / unsafe-scheme drop / scheme-less drop /
      no-resolver).

## Verification

- [x] `pnpm verify:fast` green.
- [x] Self code-review over branch diff (high-effort workflow review);
      all findings addressed (export href policy is the main fix).
- [x] Manual smoke in `pnpm dev` confirmed super/subscript + strikethrough
      apply and render in the real editor (prototype toolbar, since
      reverted). Export path exercised by tests.

## Deferred / follow-ups

- **Toolbar exposure** of strikethrough / highlight / super-subscript in
  the slides text-edit toolbar — pure front-end, no model/export work.
- **Speaker-notes hyperlinks** are not exported (the importer's
  `parseNotes` also passes no rels map, so they don't round-trip either).

## Phase B — universal typographic properties (shared `InlineStyle`)

Functionality-first (model + shared renderer + slides import/export +
tests); toolbar UI deferred. Each new field goes in `CLEAR_INLINE_STYLE`
and BOTH `inlineStylesEqual` sites (types.ts + text-editor.ts). Rebuild
`@wafflebase/docs` dist after model changes.

- [x] **B.1 `strikeStyle` (single/double)** — `@strike`
      `sngStrike`/`dblStrike`. Model + double-line render (`paint-layout.ts`)
      + slides import/export + round-trip test.
- [ ] **B.2 `underlineStyle` + `underlineColor`** — `@u` enum + `<a:uFill>`.
- [ ] **B.3 `caps` (all/small)** — `@cap`; measure + paint transform.
- [ ] **B.4 `letterSpacing`** — `@spc`; measure + paint.

## Wrap-up

- [x] Capture lessons in the paired `-lessons.md`.
- [ ] PR: Summary + Test plan.
