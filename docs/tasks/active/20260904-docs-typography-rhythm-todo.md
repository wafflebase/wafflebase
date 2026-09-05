# Docs: restore the vertical rhythm the named styles already describe

## Problem

A plain meeting-notes document renders with no typographic hierarchy at
all. Reading the live document
(`/shared/e8df2022-923d-4d86-b60d-d8f50e9c4f62`) through
`window.__docsEditor.getDoc()._document` returns 13 blocks that all carry
the **identical** block style:

```
title      mt=0 mb=8 lh=1.5
paragraph  mt=0 mb=8 lh=1.5
heading1   mt=0 mb=8 lh=1.5   <- "Decisions"
paragraph  mt=0 mb=8 lh=1.5
list-item  mt=0 mb=8 lh=1.5
heading1   mt=0 mb=8 lh=1.5   <- "Action items"
list-item  mt=0 mb=8 lh=1.5
list-item  mt=0 mb=8 lh=1.5
...
```

Three separate defects compound into "the typography is not beautiful".

### 1. Heading space-before is never applied (bug)

`BUILTIN_STYLES` (`packages/docs/src/model/named-styles.ts:86`) defines
`heading-1: { marginTop: 27, marginBottom: 8 }`, but the blocks carry
`marginTop: 0`. `view/layout.ts:383` reads `y += block.style.marginTop`
directly with **no named-style fallback**, so the value is simply lost.

The cause is the *materialize* seam. `materializeBlockSpacing` has one
production call site that runs per-edit —
`packages/frontend/src/app/docs/yorkie-doc-store.ts:1523`, inside
`setBlockType` — so spacing is written only when a user interactively
changes a block's type in the browser. Every other way a heading enters a
document (DOCX/markdown import, paste, `/api/v1` content PUT, the CLI,
templates, document copy) produces `marginTop: 0`.

Measured on screen, the ink gap above `Decisions` is ~22px and the gap
below it ~21px — **1:1**. A heading belongs to the content beneath it;
the ratio should be roughly 2.5–3:1. At 1:1 proximity grouping collapses
and the page reads as one undifferentiated column.

Note the asymmetry in the existing design: `resolveStyleInline` is
resolved **lazily at layout time**, `resolveStyleBlock` is materialized
**eagerly at write time**. Only the eager half loses data.

### 2. Line-height 1.5 on every style; list items spaced like paragraphs

`BUILTIN_STYLES` sets no `lineHeight` for any style, so
`DEFAULT_BLOCK_STYLE.lineHeight = 1.5` (`model/types.ts:237`) reaches a
26pt Title as well as 11pt body — a 40px line box for a 34.67px glyph.
Large type needs *tighter* leading, not the same. The symmetric
half-leading also dilutes whatever space-before/after asymmetry survives
defect 1.

Separately, `list-item` blocks carry the paragraph `marginBottom: 8`, so
items *within* one list are as far apart as separate paragraphs. Space
belongs around the list, not between every item.

### 3. Named-style greys are hardcoded light-mode hex (latent bug)

`named-styles.ts` stores literal `#666666` (subtitle, heading-4/5/6) and
`#434343` (heading-3). `defaultColorResolver`
(`packages/docs/src/model/color.ts:14`) is a string passthrough and the
docs editor passes no `colorResolver`, so those hexes paint literally on
the dark page background `#2b2b2b`:

| | contrast | WCAG AA (4.5:1) |
|---|---|---|
| `#666666` on `#2b2b2b` | 2.5:1 | fail |
| `#434343` on `#2b2b2b` | 1.5:1 | fail |

In dark mode a Heading 3 is *darker* than body text — the hierarchy
inverts. The reviewed document only uses H1, so it is latent rather than
visible today.

## Plan

- [x] **Fix 1 — resolve block spacing lazily.** Make layout fall back to
      `resolveStyleBlock(blockStyleId(block), doc.styles)` when the block
      carries no explicit spacing, mirroring how `resolveStyleInline`
      already works, so every existing document is repaired with no
      migration. Keep the eager materialize path working (it is what
      "Update to match" / "Reset" write) but stop it being the only
      source of truth.
- [x] **Fix 2 — per-style leading + list rhythm.** Give the built-in
      styles their own `lineHeight` (tight for Title/headings, 1.5 for
      body) and give `list-item` a tighter inter-item `marginBottom`.
      Landed as: `lineHeight` joins the catalog and the lazy
      `effectiveBlockSpacing` resolve (so it reaches imported/pasted
      blocks too, not only materialized ones); the list rhythm is
      **contextual** (`LayoutOptions.contextualListSpacing`, Word's
      `<w:contextualSpacing/>`) rather than a catalog edit, because
      `list-item → 'normal'` and `normal`'s values must stay identical
      to `DEFAULT_BLOCK_STYLE`'s for the sentinel to stay a no-op for
      slides/board.
- [x] **Fix 3 — theme-aware named-style colors.** Landed *not* on the
      role-based `StoredColor` seam — that would have touched ~15 paint
      sites (including a resolver-less recursive `table-renderer`) and,
      worse, leaked a `{kind:'role'}` object into `root.stylesJson` via
      "Update to match", where DOCX/PDF drop it entirely. Instead the
      built-ins gained a second color layer
      (`NamedStyleDef.inlineDark`, `#B0B0B0` / `#999999`) and
      `resolveStyleInline` a third `surface` parameter **defaulting to
      `'light'`**. Only the layout chain threads it; the one read of the
      global theme mode is `getThemeMode()` in `editor.recomputeLayout`.
      Export and the document-describing readers (caret style, range
      summaries) simply omit it, so a PDF exported from a dark-mode
      editor is still black-on-white and "Update to match" still
      persists `#434343`.
- [ ] `pnpm verify:fast` green; update `docs/design/docs/docs-named-styles.md`
      for the resolution-order change.
- [ ] Research (separate, no code): heading weight contrast, the 96-char
      measure, and the irregular type scale — parity-with-Google-Docs vs
      differentiate. Findings land in the lessons file / a design doc.

## Review

_(filled in on completion)_

## Adversarial-review round — Fix 1: the authored-spacing signal

The first cut of Fix 1 resolved spacing through a **value sentinel** and
justified it with two claims that were both false:

1. *"DOCX import drops `w:before="0"` (`docx-style-map.ts` guards on a truthy
   string)."* `Boolean("0") === true`, so `if (before)` accepted the string and
   wrote `marginTop: 0` — which the named style then silently replaced. Word's
   one-click "Remove Space Before Paragraph" emits exactly that.
2. *"The picker's Custom field reaches 1.49 or 1.51, not 1.5."*
   `LineSpacingPicker` offers **1.5 as a preset** and accepts it in Custom, and
   Word's "1.5 line spacing" is `w:line="360"` → exactly 1.5. On Title /
   Subtitle / Heading 1–4 the pick was a silent no-op; from an authored 2.0 it
   jumped to the *style's* leading rather than to 1.5.

- [x] Add three optional booleans to `BlockStyle` —
      `authoredMarginTop` / `authoredMarginBottom` / `authoredLineHeight` —
      with a third state (absent) meaning "no information, use the legacy value
      sentinel", so already-persisted documents keep being repaired with no
      migration.
- [x] Codec: three independent Tree attributes (`"1"` / `"0"`, absent emits
      nothing) in `model/crdt-attrs.ts`, so the marker rides every writer and
      reader — the editor store, the backend `docs-tree`, `/api/v1`, document
      copy, revision preview — through one encoding.
- [x] Write sites: the DOCX importer (finite guards, per-field marks),
      `Doc.applyBlockStyle` (the single interactive funnel, via
      `markAuthoredSpacing`), the docs→docs clipboard sanitizer.
      `materializeBlockSpacing` **clears** the markers (applying a style clears
      direct paragraph formatting), so a copied heading still tracks a later
      redefinition.
- [x] DOCX export emits the authored-zero / authored-default cases, plus an
      explicit `w:lineRule="auto"`, so the distinction survives an
      export→import cycle. `||` not `??`, keeping it a pure superset of today's
      output; the materialized-heading double-gap stays a follow-up.
- [x] `assertValidBlockStyle` accepts the three keys as optional booleans
      (the `GET` → edit → `PUT` identity).
- [x] Corrected both false comments in `named-styles.ts` and the matching
      design-doc prose in `docs/design/docs/docs-named-styles.md`.
- [x] Regression tests that fail without the change: the importer's
      `w:before="0"` / `w:after="0"` / `w:line="360"` cases, the codec's
      three-state round-trip, the export round-trip, the clipboard round-trip,
      and the `Doc.applyBlockStyle` funnel proving a 1.5 pick sticks on a Title.

## Adversarial-review round — Fix 2: DOCX list spacing

Three reviewers independently found the same defect. The first cut emitted
`<w:contextualSpacing/>` on every list item, but the exporter gives **no**
`<w:pStyle>` to list items *or* body paragraphs — so every `<w:p>` in an
exported file was the default `Normal`. ECMA-376 §17.3.1.9 scopes the element
to paragraphs of the **same style**, so Word also suppressed the space after
the *last* bullet, against the paragraph following the list. The editor paints
8 px there; Word rendered 0.

The comment defending the choice was false in the same way as Fix 1's:

> *"…rather than exporting the computed zero — the zero depends on the block's
> neighbours, so baking it in would also flatten the gap after the last item."*

Exporting the computed zero would **not** have flattened it (the last item's
computed `marginBottom` is 8, because its `next` is not a `list-item`). The
sentence described the failure mode of the option that was chosen.

- [x] `export/docx-templates.ts` defines a `ListParagraph` paragraph style —
      `basedOn="Normal"`, `<w:contextualSpacing/>`, **no metrics** — plus an
      exported `LIST_PARAGRAPH_STYLE_ID` so the reference and the definition
      cannot drift. Written out explicitly rather than left to Word's built-in
      gallery: Word's own List Paragraph carries `w:ind w:left="720"`, and a
      consumer with no gallery resolves a dangling `w:val` to the *default*
      style, which reinstates the bug.
- [x] `buildParagraphPropertiesXml`'s `opts.contextualSpacing` became
      `opts.listItem` — one flag emitting the `pStyle` and the element
      together, so they cannot be separated. A heading level still wins (two
      `<w:pStyle>` children violate `CT_PPr`; Word refuses the file).
- [x] `<w:contextualSpacing/>` moved after `<w:ind>`, its `CT_PPr` sequence
      slot. `<w:jc>`'s pre-existing early position left alone — it is in every
      file already shipped.
- [x] Corrected the false comments: the export option's doc comment, the
      `BlockSpacingContext.contextualListSpacing` comment, the
      "same style ≡ neighbour is a bullet" comment inside
      `effectiveBlockSpacing` (whose conclusion inverted its own premise —
      `blockStyleId` maps paragraphs to `normal` too), the export test's
      comment, and the matching design-doc prose.
- [x] Regression tests. Four fail with the `pStyle` reverted and the element
      left in place: two unit (`pairs <w:contextualSpacing/> with the
      ListParagraph style`, `uses the same style id the paragraph writer
      references`) and two end-to-end over `[para, item, item, para]`, one of
      which encodes Word's rule directly — "suppressed iff one carries the
      element AND both resolve to the same style" — and compares the three
      boundaries against what the editor paints (`[false, true, false]`).

Known gap, stated because the export now looks more complete than it is: the
exporter emits **no `<w:numPr>` and no numbering part**, and the importer has
no `list-item` branch at all. Lists export as flush-left paragraphs with no
bullets and re-import as paragraphs. `ListParagraph` gives that round-trip a
semantic hook it lacked; it does not close it.

Known limitation carried forward: there is no direct "un-author this field"
control, because both stores materialize only when the `StyleId` changes.
Switching style and back is the affordance; making the Text style dropdown
force a materialize on every pick (Google Docs' behaviour) is the companion
change, deliberately out of scope.

## Adversarial-review round — Fix 3: "Update to match" destroyed the dark layer

Fix 3 added the second color layer (`NamedStyleDef.inlineDark`) and a `surface`
parameter, and defended it with a claim that was true but *incomplete* in a way
that reintroduced the bug it fixed:

> *"The document-describing readers stay on the light default … This is what
> stops dark-mode presentation being persisted as authored data: 'Update
> Heading 3 to match' clicked in dark mode captures `#434343`, never
> `#B0B0B0`."*

Keeping `#B0B0B0` out is one hazard; the other is that the capture is the
**computed** style, so `#434343` reached it whether or not anyone chose a color
— and `editor.ts` wrote the whole capture into `DocStyles`. Since
`resolveStyleInline` spreads a document override last and unconditionally on
both surfaces, a dark-mode user who toggled **Bold** on a Heading 3 and clicked
"Update Heading 3 to match" permanently repainted every Heading 3 at 1.43:1 on
the `#2b2b2b` page. Only "Reset style" undid it, and that dropped the bold.

- [x] `omitBuiltinStyleDefaults(id, captured, surface = 'light')` in
      `model/named-styles.ts`: drop every property whose captured value already
      equals what the built-in supplies **on the capture surface**.
      `updateStyleToMatch` routes its definition through it, so a Bold-then-
      update stores `{ bold: true }` and Heading 3 keeps resolving per surface.
- [x] Pruned against the **built-in**, never the effective resolution —
      `updateStyleDefinition` replaces the whole entry, so a Heading 1 already
      redefined to 30 pt must survive a later italic-only update (30 ≠ 20 →
      kept). Applies to the spacing half too.
- [x] The prune lives at the capture site, not in the stores: `DocStore`'s
      contract is "store this definition", and a programmatic caller may
      legitimately mean a value equal to the built-in.
- [x] Corrected the incomplete comments: `resolveStyleInline`'s "spread last and
      unconditionally" paragraph, both light-surface comments in
      `model/caret-style.ts`, and the design doc's `surface`-threading bullet,
      which now points at a new
      *"Update to match" must not capture defaults* section quoting the
      original claim.
- [x] Regression tests. Nine fail with the prune reverted to identity:
      `test/model/caret-style-surface.test.ts` (the helper, incl. "resolves
      identically to no entry at all", the prior-redefinition case and the
      heading-6 `italic: false` case) and a new
      `test/view/update-style-to-match.test.ts` that mounts the real editor,
      toggles Bold in dark mode, and asserts the stored override is
      `{ bold: true }` and that Heading 3 still resolves `#B0B0B0` dark /
      `#434343` light.

Accepted behaviour change: deliberately picking `#434343` — the catalog's own
Heading 3 grey — and updating the style now yields `#B0B0B0` in dark mode
rather than a frozen `#434343`. Picking the value the style already has is
indistinguishable from not picking it.

Known gap: `setDocStyles` is untouched, so a user who ran "Save as my default
styles" *before* this fix has a frozen `#434343` in their saved payload and
"Use my default styles" re-applies it. Newly saved defaults are clean.
