---
title: docs-named-styles
target-version: 0.4.9
---

# Docs Named Styles

## Summary

Promote the docs word processor's hardcoded heading/title/subtitle style
defaults into a **document-scoped, redefinable style registry** that matches
Google Docs' "Paragraph styles" model. The fixed catalog (Normal text, Title,
Subtitle, Heading 1–6) stays — users cannot invent arbitrary named styles
(Google Docs parity) — but each style's *definition* becomes editable per
document via "Update '<style>' to match" and resettable via "Reset styles".
A per-user "default styles" blob (Save / Use my default styles) is persisted
in the backend so a user's redefinitions carry across documents.

This also refreshes the built-in style values to Google Docs defaults
(size ladder, per-level weight, grayscale color hierarchy, paragraph spacing).

Roadmap item: Phase **6.5 Named Styles** in
[docs-wordprocessor-roadmap.md](docs-wordprocessor-roadmap.md).

## Goals / Non-Goals

**Goals**

- A document-level style registry stored in the Yorkie CRDT (root level,
  beside `pageSetup`) holding **only overrides** of built-in style defs.
- "Update '<style>' to match" — redefine a style from the caret block's
  current formatting, minus whatever that block merely *inherited* from the
  style (see
  ["Update to match" must not capture defaults](#update-to-match-must-not-capture-defaults));
  all blocks of that style reflow.
- "Reset '<style>'" and "Reset styles" — drop overrides back to built-ins.
- Refine built-in Title/Subtitle/Heading 1–6 values to Google Docs defaults.
- Expose Heading 4–6 in the Styles dropdown (currently H1–3 only).
- Per-user default styles persisted in backend ("Save / Use my default
  styles").

**Non-Goals**

- Arbitrary user-named custom styles (Word model). Out of scope by design.
- Character-level cascade for *direct* formatting tracking (Google Docs'
  "clear formatting reverts to style") beyond what already exists.
- Changing the **Normal** text body defaults (line spacing 1.5, space-after
  8 px) — kept as-is to avoid reflowing every existing document, and because
  `normal`'s block values must stay identical to `DEFAULT_BLOCK_STYLE`'s for
  the spacing resolution below to be a no-op for slides/board. **Two** documented
  deviations from Google Docs, which uses 1.15 line spacing and space-after 0.
  The second is what makes list items need the contextual rule below: in
  Google Docs there is no inter-item gap to remove, because a paragraph has no
  space-after at all.
- A "list" named style, or any user control over list spacing. The inter-item
  rhythm is contextual (below), not a style, and is not redefinable. (The
  `ListParagraph` style the DOCX exporter writes is not a counter-example: it
  lives only in the exported file, where a *paragraph style* is the only way to
  express "these paragraphs are a group" — see
  [Exporting the list rhythm](#exporting-the-list-rhythm-is-a-style-problem-not-a-spacing-one).
  Nothing in `STYLE_IDS` changes.)

## Proposal Details

### Style catalog & block reference

Nine styles keyed by a stable `StyleId`:

```ts
type StyleId =
  | 'normal' | 'title' | 'subtitle'
  | 'heading-1' | 'heading-2' | 'heading-3'
  | 'heading-4' | 'heading-5' | 'heading-6';
```

A block's reference to its style is **derived from existing fields** — no block
model change, full backward compatibility:

| Block | StyleId |
| --- | --- |
| `paragraph`, `list-item` | `normal` |
| `title` | `title` |
| `subtitle` | `subtitle` |
| `heading` + `headingLevel: N` | `heading-N` |
| `horizontal-rule`, `table`, `page-break` | `normal` (no style applied) |

`blockStyleId(block): StyleId` lives in `model/named-styles.ts`.

### Data model

```ts
interface NamedStyleDef {
  inline: Partial<InlineStyle>;   // bold, italic, fontSize, fontFamily, color
  block: Partial<BlockStyle>;     // spacing only: marginTop, marginBottom, lineHeight
}

// Document registry — overrides only; an empty/absent entry means "built-in".
type DocStyles = Partial<Record<StyleId, Partial<NamedStyleDef>>>;
```

`BUILTIN_STYLES: Record<StyleId, NamedStyleDef>` holds the refreshed defaults
below. Resolution deep-merges override over built-in:

```ts
resolveStyleInline(id, docStyles) = { ...BUILTIN_STYLES[id].inline, ...docStyles?.[id]?.inline }
resolveStyleBlock(id, docStyles)  = { ...BUILTIN_STYLES[id].block,  ...docStyles?.[id]?.block }
```

An entry in `docStyles` therefore means "the document decided this", and the
inverse direction has a guard of its own: `omitBuiltinStyleDefaults(id, def)`
drops from a *captured* definition every property that already equals the
built-in, so "Update to match" cannot fill the registry with defaults nobody
chose. See
["Update to match" must not capture defaults](#update-to-match-must-not-capture-defaults).

`Document` gains an optional `styles?: DocStyles` field, beside `pageSetup`.

### Built-in values (Google Docs defaults)

Font = Arial. Heading spacing converted pt→px at 96 dpi (`px = pt × 4/3`,
rounded). Weight is **not** uniform — see the audit note below the table.

| Style | size | weight | color (light) | color (dark) | space-above / below (px) | leading | line box (px) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal | 11 | — | #000000 | — | 0 / 8 | 1.5 | 22.0 |
| Title | 26 | — | #000000 | — | 0 / 4 | 1.1 | 38.1 |
| Subtitle | 15 | italic | #666666 | #999999 | 0 / 21 | 1.25 | 25.0 |
| Heading 1 | 20 | — | #000000 | — | 27 / 8 | 1.2 | 32.0 |
| Heading 2 | 16 | **bold** | #000000 | — | 24 / 8 | 1.25 | 26.7 |
| Heading 3 | 14 | **bold** | #434343 | #B0B0B0 | 21 / 5 | 1.3 | 24.3 |
| Heading 4 | 12 | — | #666666 | #999999 | 19 / 5 | 1.4 | 22.4 |
| Heading 5 | 11 | — | #666666 | #999999 | 16 / 5 | 1.5 | 22.0 |
| Heading 6 | 11 | italic | #666666 | #999999 | 16 / 5 | 1.5 | 22.0 |

An em dash in the dark column means the style sets no color at all and inherits
the theme's body ink. The `#000000` entries are likewise "no `color` key" — the
theme default, not a stored black. See
[Theme-aware colors](#theme-aware-colors-the-light--dark-surfaces) below.

> Exact size/color/spacing values verified against a Google Docs document's
> own `word/styles.xml`, exported immediately after
> `Format → Paragraph styles → Options → Reset styles` so the reading is the
> product's factory catalog rather than an account's saved default styles.
>
> **That audit corrected three values this table previously got wrong.** The
> earlier text asserted "headings are non-bold; weight comes from size +
> grayscale color", and the catalog matched the assertion rather than Google:
> Google's factory **Heading 2 and Heading 3 are bold**, and its **Subtitle is
> italic**. Its ladder is non-monotone in weight — Heading 1 is regular and the
> two levels beneath it are bold — which reads oddly but is what the product
> does. Third, Subtitle's space-below was `16`, the raw **point** number written
> into a pixel field; every other spacing value in the table had been converted,
> so this was the single missed `× 4/3` (16 pt = 21 px).
>
> The lesson worth keeping: the previous version of this claim was pinned by a
> unit test that looped over every style asserting `bold === undefined`. It
> passed for two months. A test that encodes a belief about another product
> instead of measuring it will defend the error it was written to prevent.

**Leading is the one column that is deliberately *not* Google Docs**, which
applies 1.15 uniformly to every style. A line-height multiplier scales the dead
space above and below the glyphs with the type size, but the optical gap a
reader needs is roughly constant in absolute terms, not proportional — held at
one number, a 26 pt Title gets a 52 px box for 34.7 px of glyph and floats in
air while the body text that actually needs the leading gets the same ratio. So
the multiplier falls as the size rises. The resulting line boxes stay strictly
non-decreasing with size (right-hand column) — normal, h5 and h6 are all
11 pt and share a 22.0 px box — so no heading is ever shorter than body
text; `test/model/named-styles.test.ts` pins that ordering, not just the
individual numbers. Heading 5 and 6 are body-sized, so tightening them would
only make them read as cramped body text.

### List rhythm is contextual, not a style

`blockStyleId` maps `list-item → 'normal'`, so items inherit the paragraph's
8 px space-after and a three-item list is spaced like three paragraphs. Space
belongs *around* a list, not between its items.

The rule lives in `effectiveBlockSpacing`'s `BlockSpacingContext`: a
`list-item` whose previous sibling is also a `list-item` gets `marginTop: 0`,
one whose next sibling is also a `list-item` gets `marginBottom: 0`. The run's
first and last items keep their outer gaps, so the list as a whole is separated
from its neighbours exactly as one paragraph would be, and a one-item list is
untouched. This is close to — but **not identical with** — Word's
`<w:contextualSpacing/>`, which is what the DOCX exporter emits for list items.
The two rules differ in what they scope over, and getting that wrong shipped a
bug; see [Exporting the list rhythm](#exporting-the-list-rhythm-is-a-style-problem-not-a-spacing-one)
below.

Three properties are load-bearing:

- **It only touches *inherited* spacing.** A list item carrying an authored
  gap keeps it, so pasting paragraphs-with-custom-spacing as a list does not
  silently flatten them. Direct paragraph formatting always wins — "inherited"
  here means exactly what `effectiveBlockSpacing` means by it below (an
  `authored*` marker of `false` or absent, or, with no marker, a value equal to
  `DEFAULT_BLOCK_STYLE`'s).
- **It is opt-in**, via `LayoutOptions.contextualListSpacing` on
  `computeLayout`, exported as the shared `DOCS_LAYOUT_OPTIONS` constant that
  the editor, the PDF exporter and the CLI paginator all pass. Slides/board
  text bodies run through the same `computeLayout` and pass nothing: a slide
  bullet seeded by `seedPlaceholderBlocks` carries the identical inherited
  `marginBottom: 8`, and turning this on for them would move every slide's
  visual baselines, its autofit-shrink scale and its auto-grown table rows.
  (Slides bullets arguably want it too — a follow-up with its own baselines to
  re-approve.)
- **It is resolved outside the incremental layout cache.** Contextual spacing
  depends on a block's *neighbours*, and turning the paragraph after a list
  into a bullet does not dirty the bullet above it. Margins are recomputed on
  every pass regardless of a cache hit, so this cannot go stale; the cached
  half (`lines`, whose heights depend on the leading) is neighbour-independent.

The alternative of a new `StyleId 'list'` was rejected: `STYLE_IDS` drives a
fixed Google-Docs-parity Styles menu, `blockStyleId` would stop returning
`'normal'` for bullets (so "Update Normal to match" would no longer reach
them), and a named style has no neighbour context — it cannot express "space
around the run" at all. An unconditional `marginBottom: 0` on list items was
rejected for removing the gap after the list too.

### Exporting the list rhythm is a style problem, not a spacing one

The first cut of the export emitted `<w:contextualSpacing/>` on every list item
and justified it with a claim that is **false**:

> *"…which is what the DOCX exporter emits for list items rather than exporting
> the computed zero — the zero depends on the block's neighbours, so baking it
> in would also flatten the gap after the last item."*

Exporting the computed zero would not have flattened that gap: the last item's
computed `marginBottom` is 8 px precisely because its `next` is not a
`list-item`. The claim described the failure mode of the option that was
*chosen*, not of the one that was rejected.

ECMA-376 §17.3.1.9 scopes `<w:contextualSpacing/>` to paragraphs **of the same
style**, and the exporter gives body paragraphs no `<w:pStyle>` at all — so in
an exported file every `<w:p>`, bullet and paragraph alike, resolved to the
default `Normal`. Word therefore also suppressed the last bullet's space-after
against the paragraph *following* the list: 8 px on screen, 0 in Word.

The fix is to make the scope real rather than to abandon the element:

- `docx-templates.ts` defines a `ListParagraph` paragraph style —
  `basedOn="Normal"`, `<w:contextualSpacing/>`, and **no metrics of its own**.
  It exists to be a distinct *identity*, not to move anything.
- `buildParagraphPropertiesXml` emits `<w:pStyle w:val="ListParagraph"/>`
  alongside the element, and the two always travel together (`opts.listItem`,
  one flag, not two). A heading style wins if a corrupt document somehow
  carries both, because two `<w:pStyle>` children violate `CT_PPr` and Word
  refuses the file — a worse failure than a mis-spaced bullet.
- The element is written after `<w:ind>`, which is `CT_PPr`'s sequence
  position for it. (`<w:jc>` remains out of sequence — it belongs after
  `<w:contextualSpacing/>` — because that ordering is in every file this
  exporter has already shipped; straightening it is its own change.)

Writing the style out explicitly, rather than leaning on Word resolving the
built-in `List Paragraph` from its own gallery, is load-bearing twice over.
Word's built-in carries `w:ind w:left="720"`, which would indent exported items
by half an inch the editor never painted; and a consumer with no built-in
gallery (LibreOffice, Google Docs, this package's own importer) resolves a
dangling `w:val` to the *default* style — putting all four paragraphs back on
`Normal` and reinstating the bug in the file that was supposed to fix it.

Keeping the element rather than baking the zero also keeps the export live: a
bullet inserted or deleted in Word re-resolves, where a baked `w:after="0"`
would be stale the moment the file is edited.

Not fixed here, and worth stating because the export looks more complete than
it is: this exporter emits **no `<w:numPr>` and no numbering part**, and the
importer has no `list-item` branch at all. Lists export as flush-left
paragraphs with no bullets and re-import as paragraphs. `ListParagraph` gives
that round-trip a semantic hook it did not have, but it does not close it.

### Cascade resolution model

Two distinct paths, mirroring the existing architecture:

- **Inline (font / size / bold / italic / color) — lazy, registry-driven.**
  `resolveBlockInlines(block, docStyles?)` uses
  `resolveStyleInline(blockStyleId(block), docStyles)` as the base layer under
  each inline's explicit style (replaces the hardcoded
  `getHeadingDefaults` / `TITLE_DEFAULTS` / `SUBTITLE_DEFAULTS` constants).
  Threaded through `computeLayout(..., docStyles?)` → `layoutBlock(..., docStyles?)`.
  Default (no arg) = built-in resolution, so slides text-box editor, PDF
  exporter, and CLI keep working unchanged; the docs editor and PDF exporter
  pass `document.styles`. Result: "Update to match" reflows every block of the
  style instantly with **no block rewrites**. A third argument, `surface`,
  selects the dark-page variant of the catalog's greys and defaults to
  `'light'` — see [Theme-aware colors](#theme-aware-colors-the-light--dark-surfaces).

- **Block spacing (marginTop / marginBottom / lineHeight) — lazy at layout,
  plus an eager materialize for non-layout readers.** The style's block defaults are still
  written into `block.style` at the moment of:
  - **apply** (`setBlockType`) — when the *previous* and *next* `StyleId`
    differ, re-materialize spacing (paragraph↔list-item, both `normal`, is a
    no-op, so a bullet toggle never disturbs spacing);
  - **update** (`updateStyleDefinition`) — re-materialize spacing for every
    block whose `blockStyleId === styleId`;
  - **reset** — re-materialize to built-in spacing.

  Direct per-paragraph spacing edits remain on `block.style` and are treated as
  direct formatting (Google Docs parity).

  That eager write is **no longer the source of truth for rendering.** It has
  exactly one production per-edit call site (`YorkieDocStore.setBlockType`), so
  every other way a heading enters a document — DOCX/markdown import, paste,
  `/api/v1` content PUT, the CLI, templates, document copy — produced
  `marginTop: 0`, and `computeLayout` read that raw. A real meeting-notes
  document therefore had *every* block at `{marginTop: 0, marginBottom: 8}`:
  Heading 1's 27 px space-before existed only in the catalog. The gap above a
  heading measured 1:1 against the gap below it, so proximity grouping
  collapsed and the page read as one undifferentiated column.

#### Lazy spacing resolution (`effectiveBlockSpacing`)

`computeLayout` now resolves spacing once per block through
`effectiveBlockSpacing(block, docStyles)` and **publishes the result on
`LayoutBlock.spacing`**. `paginateLayout` reads that field rather than
`block.style`, so the two walks that duplicate the same `y` accumulation cannot
disagree — and `paginateLayout` needs no `docStyles` parameter, which would
otherwise have to be threaded through ~35 call sites and remembered by every
future one.

The resolution rule covers all three style-owned fields — `marginTop`,
`marginBottom` **and `lineHeight`** — and reads, per field `k`:

```
authored = block.style[AUTHORED[k]]            // true | false | undefined
        ?? block.style[k] !== DEFAULT_BLOCK_STYLE[k]   // legacy value sentinel

out[k] = authored ? block.style[k]
                  : resolveStyleBlock(id, docStyles)[k] ?? DEFAULT_BLOCK_STYLE[k]
```

##### The authored signal

`BlockStyle` carries three optional booleans — `authoredMarginTop`,
`authoredMarginBottom`, `authoredLineHeight` — that say whether the paragraph
*chose* each style-owned value or merely inherited it. Three states:

| state | meaning | written by |
|---|---|---|
| `true` | direct paragraph formatting; honour it literally, `0` and `1.5` included | the DOCX importer (a `w:spacing` attribute is present), `Doc.applyBlockStyle` (the toolbar funnel), the docs→docs clipboard |
| `false` | the paragraph authored nothing; the named style supplies it | `materializeBlockSpacing` only |
| absent | no information — fall back to the value sentinel below | legacy blocks, older peers |

**Why this exists at all.** The first cut of this design had only the value
sentinel — "a field still equal to `DEFAULT_BLOCK_STYLE`'s value carries no
information" — and justified it with two claims that were both **false**:

1. *"DOCX import drops `w:before="0"` because it guards on a truthy string."*
   `Boolean("0") === true` in JavaScript, so `if (before)` accepted the string
   and wrote `marginTop: 0`. Word's one-click "Remove Space Before Paragraph"
   emits exactly `<w:spacing w:before="0"/>`, and `0` is a valid explicit
   `ST_TwipsMeasure` that outranks the paragraph style in OOXML's formatting
   hierarchy. Every such paragraph silently got the style's 27 px back.
2. *"The toolbar's Custom field reaches 1.49 or 1.51, not 1.5."*
   `LineSpacingPicker` offers **1.5 as a preset**, and its Custom number input
   accepts 1.5. Word's "1.5 line spacing" is `w:line="360"` → exactly 1.5 too.
   So on Title / Subtitle / Heading 1–4 the pick was a silent no-op, and from
   an authored 2.0 it jumped the block to the *style's* leading rather than to
   1.5.

Both are the same shape of argument — "that value is unreachable" — and both
were wrong, which is why the fix is a signal rather than a better sentinel.

**Three flat booleans, not a set.** `applyBlockStyle` in both stores is
`normalizeBlockStyle({ ...block.style, ...patch })`, and `normalizeBlockStyle`
is `{ ...DEFAULT_BLOCK_STYLE, ...style }`. Flat booleans make that existing
spread already correct: a patch `{ lineHeight: 1.5, authoredLineHeight: true }`
leaves a previously-set `authoredMarginTop` alone, because spreading an absent
key overwrites nothing. An array or nested object would replace the whole
marker set, so every merge site would need a bespoke union helper — and a
writer that forgot it would silently reintroduce the bug.

**Per field, not one flag per paragraph.** A single "this paragraph authored
its spacing" flag is coarser than the controls that write it: the line-spacing
picker authors `lineHeight` alone, so on a Heading 1 one click would also
promote the *unauthored* `marginTop: 0` to authored and destroy the heading's
27 px space-before. Per-field is the minimum granularity that makes a
single-field control safe.

**On the wire** (`model/crdt-attrs.ts`) they are three independent Tree
attributes of the same names, valued `"1"` / `"0"`; an absent marker emits
nothing. Three attributes rather than one packed key because `Tree.styleByPath`
is per-attribute LWW, so a packed key loses a marker when two peers author
different fields on the same paragraph concurrently. `false` is emitted as the
literal `"0"` rather than by omission because `styleByPath` **merges**: a clear
that worked by omitting would need a matching `removeStyleByPath` at every CRDT
write site (three today, plus every future one), and a writer that forgot it
would resurrect the marker. Cost: a materialized block carries three redundant
`"0"` attributes.

There is exactly one encoding, used by all three writers (`YorkieDocStore`, the
backend's `docs-tree.ts`, `model/crdt-tree.ts`) and all three readers, so the
marker rides `/api/v1` GET/PUT, `POST /documents/:id/copy` and revision preview
for free. `assertValidBlockStyle` accepts the three keys as optional booleans,
which is what keeps the documented `GET` → edit → `PUT` identity intact.

**An old client** ignores the attributes (`parseBlockStyleAttrs` iterates a
fixed key list), so it renders with the value sentinel — today's behaviour.
Degradation, never corruption. The one lossy path is a whole-node rebuild by an
old writer (an old backend PUT, an old `splitBlock`), which drops the markers
and falls back to the sentinel. A mixed-version session can therefore show
different heading gaps to different peers until everyone reloads: a rendering
divergence only, nothing written, no convergence risk.

##### The legacy value sentinel

With no marker the rule is the original one: *a spacing field that still
carries what a style-unaware writer would have produced carries no information,
so the style supplies it; anything else is direct paragraph formatting and
wins.* Presence (making the fields optional and keying on attribute absence) is
the cleaner long-term model but it repairs nothing: `BlockStyle.margin*` are
required numbers, `serializeBlockStyleAttrs` emits every finite field, and the
frontend seeds `marginTop: "0"` / `marginBottom: "8"` into the first block of
every new document. A presence signal would need a migration; the value rule
repairs every already-persisted document at the next repaint with **zero CRDT
writes**.

Why it is safe rather than a magic number:

1. **It agrees with the eager path by construction.** Both read
   `resolveStyleBlock`, so for every built-in *and* every override the two
   produce the same number — including an override back *to* the default. A
   heading typed in the browser and one imported now render identically, which
   is the defect.
2. **It is a provable no-op for callers that pass no registry** — slides,
   board, and the shared text-box editor. Their blocks are all
   `paragraph`/`list-item` → `blockStyleId` → `normal`, and
   `resolveStyleBlock('normal')` is *identically* the sentinel pair. Sentinel
   in, sentinel out. `STYLE_OWNED_SPACING_DEFAULTS` derives from
   `DEFAULT_BLOCK_STYLE` and a test asserts that equality, so the invariant
   fails loudly if anyone edits `BUILTIN_STYLES.normal.block`. **This is why
   the tighter list rhythm is contextual rather than a catalog edit — editing
   `normal` would silently move every slides/board paragraph's gap and
   leading.** PPTX-imported paragraphs carry `marginBottom: 0`, which is ≠ 8,
   so they are read as authored and preserved.

   The markers only strengthen that: `true` returns the block's own value
   unconditionally (identity by construction, no equality needed), and `false`
   is written by exactly one function, `materializeBlockSpacing`, which
   slides/board never reach. A test enumerates marker × value × block type and
   asserts the round-trip.

Costs, stated rather than hidden:

- A block with **no marker** whose author genuinely meant the default value
  still loses: an `/api/v1` content PUT written before the marker existed, or
  one from an older client, that deliberately puts `marginTop: 0` on a heading
  renders with the style's 27. Every writer in this repo now stamps the marker,
  so this narrows to already-persisted blocks and genuinely older peers — where
  it is the behaviour that repairs them.
- Applying a named style resets line spacing along with the margins
  (`materializeBlockSpacing` writes all three and clears all three markers).
  That is Google Docs' behaviour, and it is required for the eager and lazy
  paths to keep agreeing.
- **There is no direct "un-author this field" control.** Both stores materialize
  only when the `StyleId` actually changes (`nextStyleId !== prevStyleId`, which
  is what keeps a bullet toggle from disturbing spacing), so re-applying the
  *same* style is a no-op. Switching to another style and back is the
  affordance today. Google Docs re-applies on every pick; letting the Text
  style dropdown force a materialize even when the id is unchanged is the
  companion change, deliberately not taken here.
- Every existing document's PDF export shifts vertically and may re-paginate.
  That is the intended repair, but it is a visible change to a shipped
  artifact.
- Table cells still apply no vertical block spacing at all
  (`table-layout.ts:layoutCellBlocks` stacks lines by height and never reads
  the margins), so a heading inside a cell gains nothing. Pre-existing and
  unchanged.

##### Where the marker is written

| site | what it does |
|---|---|
| `import/docx-style-map.ts` | guards on `Number.isFinite(parseInt(...))`, not truthiness, and marks each field the `<w:spacing>` element actually carries. Covers `docx-parser.ts` and the CLI's `docs import` for free |
| `model/document.ts` `Doc.applyBlockStyle` | the single funnel for every interactive write — the toolbar's line-spacing picker, alignment, the slides text-box editor — wrapped in `markAuthoredSpacing`. Deliberately **not** in the toolbar: a per-control marker is one the next control forgets. `indent`/`outdent` pass only `marginLeft`, so they mark nothing |
| `view/clipboard.ts` `sanitizeBlockStyle` | reads the three booleans off the internal docs→docs payload, so a copy-paste does not silently revert an authored value |
| `model/named-styles.ts` `materializeBlockSpacing` | writes `false` — see below |

Writers deliberately **not** changed: the HTML and plain-text paste paths
(`makeBlock`) always produce `{...DEFAULT_BLOCK_STYLE}` and authored nothing;
`createBlock` / `createEmptyBlock` / `createTableBlock`; `splitBlock`, which
copies the serialized style and so propagates markers already; and every
slides/board/Miro block factory, where the markers are inert.

##### `materializeBlockSpacing` **clears** the markers

It writes `false`, not `true`. Its contract is "this paragraph's style-owned
spacing is now the style's, not the paragraph's", so the marker it leaves must
say *inherited*. Setting them instead would pin every materialized block to the
literal it was materialized with — invisible while `writeStylesAndRematerialize`
re-syncs values on every redefinition, but permanent for a block that leaves
that loop: copy a Heading 1 (materialized `mt=27`) into a document whose
Heading 1 is redefined to 40 and it would show 27 forever, since neither
`POST /documents/:id/copy` nor an `/api/v1` PUT rematerializes. A cleared marker
is also strictly stronger than the sentinel it replaces — "the style supplies
this" stops depending on the value happening to equal the default — which is
the precondition for eventually deleting the eager materialize.

`updateStyleToMatch` sets nothing and structurally cannot: it writes the
*registry* (`NamedStyleDef.block`) from `effectiveBlockSpacing`, whose return
type `BlockSpacing` has exactly three numbers and no marker keys. A test pins
that, because a marker leaking into `root.stylesJson` would inject
direct-formatting flags into every block the style governs on the next
materialize.

`updateStyleToMatch` is the sharp edge: it reads the caret block's spacing to
build the new definition, so it must use `effectiveBlockSpacing` too. Reading
`block.style` raw on an un-materialized heading would write `marginTop: 0` into
the registry — a CRDT write that lazy resolution can no longer undo, making
"Update to match" an undo button for this fix.

**DOCX export deliberately keeps reading raw `block.style`, and now reads the
markers with it.** `buildParagraphPropertiesXml` already emits
`<w:pStyle w:val="HeadingN"/>`, so Word applies its own Heading N
space-before; emitting ours on top would double the gap on every heading.
Direct `<w:spacing>` there keeps meaning "spacing this paragraph overrode",
which is Word's own model. Each field is emitted when the paragraph *authored*
it, or — with no marker — when the value differs from the sentinel:

```ts
if (style.authoredMarginTop    || style.marginTop > 0)                          emit w:before
if (style.authoredMarginBottom || style.marginBottom > 0)                        emit w:after
if (style.authoredLineHeight   || style.lineHeight !== DEFAULT.lineHeight)       emit w:line + w:lineRule="auto"
```

This is **required, not garnish**: without the marker an authored
`lineHeight: 1.5` exports to nothing (1.5 *is* the default) and re-imports as
the style's 1.2, and an authored `marginTop: 0` exports to nothing and
re-imports as 27 — one export→import cycle would destroy the distinction the
whole marker exists to record. ECMA-376 can express both:
`CT_Spacing/@w:before` is a `ST_TwipsMeasure` for which `0` is valid and
explicit, and direct paragraph formatting outranks the paragraph style.
`w:lineRule="auto"` is now written explicitly — it is ECMA-376's default for the
attribute, but Word always writes it and the importer's `w:line / 240` only
makes sense under `auto`.

`||`, not `??`, is deliberate: a *cleared* marker still falls through to the
value check, so a materialized Heading 1 keeps exporting the `w:before="405"`
it exports today. That output is arguably wrong — it lands on top of Word's own
Heading 1 spacing and doubles the gap, which the raw-`block.style` comment above
claims it avoids and only actually avoids for *un*-materialized headings — but
it is pre-existing, it changes every heading in every exported file, and it
deserves its own baselines. The principled rule the marker unlocks ("emit
direct `<w:spacing>` only when the paragraph authored it", i.e. `??`) is the
follow-up, and it is the reason to carry the markers on the export path rather
than strip them.

List items additionally carry `<w:pStyle w:val="ListParagraph"/>` **and**
`<w:contextualSpacing/>`, which is how the contextual rhythm round-trips — the
style is what scopes the element to bullets instead of to the whole document;
see [Exporting the list rhythm](#exporting-the-list-rhythm-is-a-style-problem-not-a-spacing-one).
A follow-up could delete the eager materialize
entirely once the DOCX exporter, the backend `docs-tree` reader, and `/api/v1`
content GET have a registry in scope — which would also collapse
`writeStylesAndRematerialize` from N block-attribute edits per redefine to a
single `stylesJson` write.

### Theme-aware colors: the light / dark surfaces

The catalog expresses two of its three hierarchy signals — size and grayscale
color — as literal hex. That is right on white paper and wrong on the dark
page (`DarkTheme.pageBackground` = `#2b2b2b`), where `#434343` scores 1.43:1
and `#666666` 2.47:1: not merely low-contrast but **inverted**, a Heading 3
rendering darker than the body text it is supposed to outrank.

No single grey fixes both. WCAG AA for normal text (4.5:1) needs relative
luminance ≤ 0.1833 against white and ≥ 0.2837 against `#2b2b2b`; the intervals
are disjoint. (The AA-large 3:1 windows *do* overlap, but only Heading 3 could
reach them: at 14 pt **bold** it lands exactly on WCAG's 14 pt-bold large-text
threshold, while Subtitle at 15 pt and Heading 4/5/6 at 12/11/11 pt are
normal-sized text. One shared grey would have to satisfy all of them, so 4.5:1
is the binding bar.) A mode-dependent value is therefore forced.

**Shape: a second color layer on the built-in, resolved at
`resolveStyleInline` time.** `NamedStyleDef` gains
`inlineDark?: Pick<InlineStyle, 'color' | 'backgroundColor'>`, and
`resolveStyleInline(id, docStyles?, surface = 'light')` spreads it between the
built-in and the document override:

```ts
{ ...builtin.inline, ...(surface === 'dark' ? builtin.inlineDark : undefined), ...override.inline }
```

Rejected alternative: moving the greys onto the role-based `StoredColor` seam
(`{ kind: 'role', role: 'muted' }`) and giving docs a theme-aware
`ColorResolver`, as slides has. Three reasons. It would have to reach ~15 paint
sites — `doc-canvas.ts` (6), `table-renderer.ts` (4, with no resolver parameter
at all and two recursive 10–15-argument functions), the PDF painter chain and
`docx-style-map.ts` — against five files here. It would leak a persisted shape
into user data: `resolveBlockInlines` merges the defaults into the run style,
and "Update to match" writes that captured style verbatim into
`root.stylesJson`, so a `{kind:'role'}` object would land in the CRDT, where
`defaultColorResolver` returns `undefined` for it and DOCX/PDF would drop the
color entirely. And it solves a problem docs does not have: role colors exist
so slides can theme *user-authored* runs, whereas these greys are the built-in
default layer, which already has a lazy resolution seam.

**The parameter is threaded, never read from a global.** Only the layout chain
carries it — `computeLayout` (as `LayoutOptions.surface`) → `layoutBlock` /
`computeTableLayout` → `layoutCellBlocks` (recursing into nested tables) →
`resolveBlockInlines`. The single read of the theme mode in the whole feature
is `getThemeMode()` in `view/editor.ts`'s `recomputeLayout`, which spreads it
over `DOCS_LAYOUT_OPTIONS`. Consequences, all load-bearing:

- **`DOCS_LAYOUT_OPTIONS` must never gain a `surface` key.** It is what the PDF
  exporter and the CLI paginator lay out with, so the omission is what keeps a
  PDF exported from a dark-mode editor black-on-white.
- **`resolveStyleInline` must never call `getThemeMode()` itself.** Docs PDF
  export runs client-side, in the same module instance where the editor already
  set dark mode, so that "simplification" would bake `#B0B0B0` headings onto
  white paper. Forcing light mode for the duration of an export is no better:
  export yields cooperatively (`export/yield.ts`), so a concurrent repaint
  would flash light greys onto the dark canvas. A parameter with a light
  default is the only re-entrant-safe shape.
- **`inlineDark` is typed to color keys only.** Metrics are resolved
  surface-blind (`assignLineHeights`, `getLineMaxFontSizePx`), so a dark
  `fontSize` or `bold` would change painted glyphs without changing measured
  lines and the screen would paginate differently from the PDF.
- **The layout cache key carries the surface.** A cached `LayoutRun.inline`
  holds the *merged* style, so a theme toggle with nothing dirty would
  otherwise repaint the previous surface's grey. (`setTheme` also drops the
  cache; the key is the belt for any other caller.)
- **The document-describing readers stay on the light default** —
  `model/caret-style.ts`, `model/range-runs.ts`, `model/document.ts`. This is
  what stops dark-mode *presentation* being persisted as authored data: "Update
  Heading 3 to match" clicked in dark mode captures `#434343`, never
  `#B0B0B0`. It is necessary and **not sufficient** — see
  ["Update to match" must not capture defaults](#update-to-match-must-not-capture-defaults)
  for the half of the invariant the first cut was missing.

**An explicitly chosen color is never remapped**, at two independent layers.
Layer 1: `resolveBlockInlines` merges the style defaults *under* the run's own
style, and the remap only ever writes into the defaults. Layer 2:
`resolveStyleInline` spreads the document override last and unconditionally, so
the moment a user redefines Heading 3's color the built-in dark layer stops
applying to that style in both modes — a redefined style belongs to the
document, not the product.

Layer 2 only holds while a registry entry means a *deliberate* redefinition,
which is the next section's subject.

#### "Update to match" must not capture defaults

The first cut of the dark layer shipped this claim, and it was false:

> The document-describing readers stay on the light default … This is what
> stops dark-mode presentation being persisted as authored data.

Keeping `#B0B0B0` out of the capture is one hazard. The other is that the
capture is the **computed** style — the run's explicit style layered over the
built-in defaults — so `#434343` arrives in it whether or not anyone chose a
color. `updateStyleToMatch` wrote that object into `DocStyles` verbatim, and
because layer 2 above spreads a document override last and unconditionally on
*both* surfaces, the stored light grey outranked `inlineDark`.

The observable defect: a user in dark mode puts the caret in a Heading 3,
toggles **Bold**, clicks "Update Heading 3 to match" — and every Heading 3 in
the document is permanently repainted `#434343` on the `#2b2b2b` page. 1.43:1,
the inverted hierarchy this whole section exists to remove, caused by a weight
change. Only "Reset style" undid it, and that dropped the bold too.

The fix is not to make the capture dark-aware (that persists dark-mode
presentation, the hazard above) but to stop capturing values nobody chose.
`omitBuiltinStyleDefaults(id, captured, surface = 'light')` drops every
property whose captured value already equals what the built-in supplies on the
capture surface, and `updateStyleToMatch` routes its definition through it. A
Bold-then-update stores `{ bold: true }` and nothing else, so Heading 3 keeps
resolving per surface.

Three properties of that rule, each load-bearing:

- **Pruned against the built-in, never against the effective resolution.**
  `updateStyleDefinition` replaces a style's whole entry, so a capture from a
  Heading 1 the document already redefined to 30 pt must keep the 30 (30 ≠ the
  built-in's 20 → kept). Comparing against `resolveStyleInline(id, docStyles)`
  would call it "unchanged" and silently revert the redefinition to 20 the next
  time anybody toggled italic and updated.
- **A value comparison is sound here, unlike the block-spacing sentinel Fix 1
  had to replace.** That sentinel was unsound because its fallback was a
  *different* number — a paragraph that authored `marginTop: 0` rendered at the
  style's 27. Here the fallback is the pruned value itself: dropping property
  `p` leaves resolution on the capture surface bit-identical, because the
  built-in layer supplies exactly what was removed. Only the *other* surface's
  resolution changes, which is the point.
- **The one user-visible consequence**, stated rather than hidden: someone who
  deliberately picks `#434343` — the catalog's own Heading 3 grey — and updates
  the style gets `#B0B0B0` in dark mode rather than a frozen `#434343`. Picking
  the value the style already has is indistinguishable from not picking it, and
  resolving it per surface is the better reading. Any other color is stored and
  paints on both surfaces.

The prune lives at the **capture** site, not in the stores: `DocStore`'s
contract is "store this definition", and a programmatic caller may legitimately
want a value that equals the built-in. `setDocStyles` is therefore untouched,
which leaves one gap — a user who ran "Save as my default styles" *before* this
fix has a frozen `#434343` in their saved payload, and "Use my default styles"
re-applies it. Newly saved defaults are clean, because they are read back out
of a registry that no longer contains captured defaults.

Contrast measured, light then dark: heading-3 9.89:1 / 6.53:1; subtitle and
heading-4/5/6 5.74:1 / 4.97:1; body ink 16.24:1 / 13.14:1. Both tiers stay
below body ink on both surfaces, so the hierarchy reads the same way round.
`test/model/named-styles.test.ts` recomputes those ratios from the shipped
values rather than quoting them.

### Store API (`DocStore`)

```ts
getDocStyles(): DocStyles;
setDocStyles(styles: DocStyles): void;
updateStyleDefinition(styleId: StyleId, def: NamedStyleDef): void; // "Update to match"
resetStyle(styleId: StyleId): void;                                // "Reset this style"
resetAllStyles(): void;                                            // "Reset styles"
```

`updateStyleDefinition` / `resetStyle` / `resetAllStyles` each run as one
batched undo unit and re-materialize block spacing for affected blocks.
Implemented in `MemStore` (plain `this.doc.styles`) and `YorkieDocStore`.
Unlike `pageSetup`, which is a nested CRDT object, the registry is stored at
the Yorkie root as a single serialized JSON string (`root.stylesJson`): it is
tiny and rarely concurrently edited, so whole-blob LWW is acceptable, and a
scalar string sidesteps Yorkie proxy double-encoding and the variable /
`StoredColor` key shapes inside a style definition. `readDocStyles`
(`packages/frontend/src/app/docs/yorkie-doc-store.ts`) therefore `JSON.parse`s
`root.stylesJson` rather than proxy-unwrapping. Backend
`packages/backend/src/yorkie/docs-tree.ts` mirrors this with a
`stylesJson?: string` field on `DocsYorkieRoot` (`JSON.stringify` on write,
`delete` on omission).

### Per-user default styles (backend)

New Prisma model + migration:

```prisma
model UserDocStyles {
  userId    Int      @id
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  styles    Json
  updatedAt DateTime @updatedAt
}
```

Endpoints (JWT, `@CurrentUser`-style like `auth.controller.ts` `getMe`):

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/auth/me/doc-styles` | Return `{ styles }` — the saved `DocStyles` (or `{}`) wrapped |
| `PUT` | `/auth/me/doc-styles` | Upsert the current user's `DocStyles`; returns `{ styles }` |

Frontend wires these into the Styles dropdown "Options" submenu:
- **Save as my default styles** → `PUT` current `getDocStyles()`.
- **Use my default styles** → `GET`, then `setDocStyles(...)`.

### UI (`text-style-group.tsx` / `text-style-options.ts`)

- Add **Heading 4 / 5 / 6** rows (shortcuts ⌥4–⌥6).
- Each style row gains a hover submenu (▸): *Apply* /
  *Update '<style>' to match* (reads the caret block's effective formatting via
  the same resolution used by the toolbar) / *Reset '<style>'*.
- Bottom **Options** entry: *Save as my default styles* / *Use my default
  styles* / *Reset styles* — mirrors Google Docs' Format → Paragraph styles.

The docs formatting toolbar (`docs-formatting-toolbar.tsx`) wires the new
callbacks to `EditorAPI` primitives that call the store methods above.

## Risks and Mitigation

- **Heading appearance change** (new sizes, weights and colors) is visible on
  every existing document, and has now moved twice: first to non-bold headings,
  then — when the values were audited against a genuinely reset Google Docs
  document — back to bold for Heading 2 and Heading 3, plus italic Subtitle.
  *Mitigation:* intentional Google Docs parity; called out in the PR;
  built-in-only — no data migration, and a user who prefers the old look can
  "Update Heading N to match" a sample.
- **Registry not understood by older clients / backend.** *Mitigation:*
  `root.stylesJson` is optional and additive at the Yorkie root (like
  `pageSetup`, though stored as a scalar JSON string rather than a nested CRDT
  object); absence resolves to built-ins.
- **Eager spacing materialization clobbers custom paragraph spacing on style
  switch.** *Mitigation:* only re-materialize when `StyleId` actually changes;
  this matches Google Docs (applying a style resets paragraph formatting).
- **A value sentinel alone cannot tell "unset" from a deliberate 0 / 8 / 1.5.**
  The first cut shipped one anyway, on two arguments that were both false:
  DOCX import does *not* drop `w:before="0"` (`Boolean("0") === true`, so
  `if (before)` accepted it), and the line-spacing picker *does* reach exactly
  1.5 (it is a preset, and Custom accepts it). Word's "Remove Space Before
  Paragraph" and its "1.5 line spacing" landed precisely on the sentinel and
  were silently overwritten by the named style. *Mitigation:* the three
  `authored*` booleans above are the signal the sentinel was standing in for.
  The sentinel remains as the **fallback for blocks with no marker**, which is
  what repairs already-persisted documents with no migration; a legacy block
  whose author genuinely meant the default is the one case still lost, and it
  is now bounded to old data and old peers rather than to every new import and
  every toolbar click. Pinned by tests on the importer, the codec, the export
  round-trip, the clipboard and the `applyBlockStyle` funnel.
- **No direct "un-author this field" control.** Both stores materialize only
  when the `StyleId` changes, so re-picking the same style does not clear a
  marker. *Mitigation:* switching style and back works today; letting the Text
  style dropdown force a materialize on every pick (Google Docs' behaviour) is
  the companion change, deliberately out of scope here.
- **Dark mode is not "fixed" by the surface layer.** Two literal-black
  defaults remain and both need the same treatment: `DEFAULT_BORDER_STYLE.color
  = '#000000'` (`model/types.ts`) makes table borders 1.48:1 on `#2b2b2b`, and
  `import/docx-style-map.ts` writes a literal `'#000000'` onto every imported
  run, so a DOCX-imported document's *body text* is black on the dark page.
  *Mitigation:* out of scope here and filed separately; neither is a
  regression.
- **Slides text bodies whose blocks are `heading` type** get the built-in greys
  merged in, and the slides resolver passes plain strings through unchanged, so
  they paint near-black on a dark deck. Pre-existing and unchanged — slides
  never passes a surface and keeps `makeColorResolver` as its only theme
  authority.
- **`setThemeMode` is a module-level global** shared with the slides text-box
  suites, so a test that switches to dark must reset in `afterEach` or it
  corrupts unrelated files. *Mitigation:* every dark test does; the precedent
  is `test/view/theme.test.ts`.
- **Threading `docStyles` through layout** touches a hot path. *Mitigation:*
  optional param defaulting to built-in; only the docs editor + PDF export pass
  it; covered by layout unit tests asserting registry override wins.
