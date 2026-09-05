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
- ~~Changing the **Normal** text body defaults.~~ **No longer a Non-Goal.** It
  was one while `normal`'s block values had to stay identical to
  `DEFAULT_BLOCK_STYLE`'s for the spacing resolution to be a no-op for
  slides/board. That invariant is now carried by the `namedStyleSpacing`
  opt-in instead, so `normal` matches Google (1.15 leading, space-after 0) and
  the catalog has no documented deviation left. The cost is real and accepted:
  every existing document's body reflows on first open, and its PDF page count
  can change. A consequence worth stating — with Google's space-after of 0
  there is no inter-item gap to remove, so the contextual list rule below is
  dormant in the shipped catalog and becomes observable only when a document
  redefines `normal`.
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

An entry in `docStyles` therefore means "the document decided this".

#### "Update to match" must not capture defaults

The inverse direction has a guard of its own: `omitBuiltinStyleDefaults(id, def)`
drops from a *captured* definition every property that already equals the
built-in, so "Update to match" cannot fill the registry with defaults nobody
chose.

This is load-bearing for the dark surface. "Update to match" captures the
*computed* style, so a Heading 3 whose author only toggled Bold still hands over
the built-in's grey, its size and its leading — and because a stored override
wins over `inlineDark`, storing the captured `#434343` would repaint every
Heading 3 at 1.4:1 on the dark page, undoing the two-layer design on one click.
Capturing on the light surface is necessary but not sufficient; the prune is
what makes it safe.

`Document` gains an optional `styles?: DocStyles` field, beside `pageSetup`.

### Built-in values (Google Docs defaults)

Font = Arial. Heading spacing converted pt→px at 96 dpi (`px = pt × 4/3`,
rounded). Weight is **not** uniform — see the audit note below the table.

| Style | size | weight | color (light) | color (dark) | space-above / below (px) | leading | line box (px) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal | 11 | — | #000000 | — | 0 / 0 | 1.15 | 16.9 |
| Title | 26 | — | #000000 | — | 0 / 4 | 1.15 | 39.9 |
| Subtitle | 15 | italic | #666666 | #999999 | 0 / 21 | 1.15 | 23.0 |
| Heading 1 | 20 | — | #000000 | — | 27 / 8 | 1.15 | 30.7 |
| Heading 2 | 16 | **bold** | #000000 | — | 24 / 8 | 1.15 | 24.5 |
| Heading 3 | 14 | **bold** | #434343 | #B0B0B0 | 21 / 5 | 1.15 | 21.5 |
| Heading 4 | 12 | — | #666666 | #999999 | 19 / 5 | 1.15 | 18.4 |
| Heading 5 | 11 | — | #666666 | #999999 | 16 / 5 | 1.15 | 16.9 |
| Heading 6 | 11 | italic | #666666 | #999999 | 16 / 5 | 1.15 | 16.9 |

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

#### Theme-aware colors: the light / dark surfaces

`inline.color` is the light-surface value — Google Docs parity, and what
PDF/DOCX export emits — and `inlineDark.color` the value the same style resolves
to when laid out for the `#2b2b2b` dark page. A single shared grey is not merely
undesirable but *impossible*: AA (4.5:1) on white needs relative luminance
≤ 0.1833 and AA on `#2b2b2b` needs ≥ 0.2837, and those intervals are disjoint.
`resolveStyleInline` therefore takes a `surface` argument that **defaults to
light**, so export paths and the document-describing readers stay mode-blind by
omission rather than by remembering to opt out. `inlineDark` is `Pick<>`-limited
to color keys: a dark-surface metric would change the painted glyphs without
changing the measured line, and page count would stop agreeing with the screen.

**Leading is uniform 1.15, matching Google Docs.** An earlier revision of this
document argued the opposite — that a constant multiplier was wrong because
"held at 1.5, a 26 pt Title gets a 52 px line box around 34.7 px of glyph and
floats in air" — and shipped a per-style ladder (Title 1.1 / H1 1.2 / H2 1.25 /
H3 1.3 / H4 1.4 / Normal 1.5) on that reasoning.

The reasoning was sound and its premise is now gone. It held *only* because
`normal` was 1.5. With `normal` at Google's 1.15 the same Title gets a 39.9 px
box for the same 34.7 px of glyph — 2.6 px of half-leading — and nothing
floats. Keeping the ladder would have bought a 1.7 px per-heading divergence
from Google in exchange for a condition that no longer arises, so it was
retired.

**`normal` is the one style a host can decline.** Its catalog values are
Google's body rhythm, which is right for a document and wrong for a slide —
and slides, board and the shared text-box editor lay out `paragraph`,
`list-item` **and `heading`** blocks through the same `computeLayout` with no
registry. The invariant that used to protect them was `normal`'s block values
being identical to `DEFAULT_BLOCK_STYLE`'s; moving `normal` breaks that by
construction.

So the catalog fallback as a whole is now an **opt-in**
(`BlockSpacingContext.namedStyleSpacing`, set only in `DOCS_LAYOUT_OPTIONS`).
A host that declines gets its block's own numbers back verbatim — exactly what
layout read before this seam existed. Gating only `normal` is not enough and
was originally got wrong: the shared `TextEditor` binds Cmd/Ctrl+Alt+1–6 and
the `# ` markdown auto-convert to `setBlockType`, so slide text bodies really
do contain `heading` blocks, and gating only `normal` left a 20 pt slide
heading's line box going 40.0 px → 30.7 px, moving every baseline under it,
`computeAutofitScale`, and auto-grown table rows.

**`lineHeight` is resolved but never materialized.** The eager
`materializeBlockSpacing` writes the two margins only. Writing leading there
would (a) put catalog values into a deck's CRDT via slides' `setBlockType`, and
(b) make `resetStyle` / `resetAllStyles` / "Update Normal to match" — which run
over every block at once — replace a paragraph the user had set to 2.0 with the
catalog's value, document-wide, on one click. Applying a style still clears the
`authoredLineHeight` marker (that is Google's "clear direct paragraph
formatting", and the only way back to the style's leading); a registry
operation passes `keepAuthoredLeading` and does not.

#### Exporting the list rhythm is a style problem, not a spacing one

On screen the rule keys on block *type* adjacency: a `list-item` next to a
`list-item` opens no gap. Word has no such notion. `w:contextualSpacing`
("Ignore Spacing Above and Below When Using Identical Styles") compares
paragraph **styles**, and every paragraph the exporter used to write was the
default `Normal` — so Word applied it across the bullet/paragraph boundary too
and ate the gap after the *last* item of a list. The two predicates are not the
same, and conflating them shipped a bug.

`export/docx-style-map.ts` reconciles them by giving list items their own
`ListParagraph` paragraph style (defined in `export/docx-templates.ts`). That
makes Word's "identical styles" test mean exactly what the editor's
"the neighbour is also a bullet" test means. It lives only in the exported
file; `STYLE_IDS` is unchanged, and nothing in the product gains a list style.

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
  style instantly with **no block rewrites**.

- **Block spacing (marginTop / marginBottom / lineHeight) — eager, materialized.**
  `block.style` stays full-value and authoritative for layout (no layout
  change for spacing). The style's block defaults are written into
  `block.style` at the moment of:
  - **apply** (`setBlockType`) — when the *previous* and *next* `StyleId`
    differ, re-materialize spacing (paragraph↔list-item, both `normal`, is a
    no-op, so a bullet toggle never disturbs spacing);
  - **update** (`updateStyleDefinition`) — re-materialize spacing for every
    block whose `blockStyleId === styleId`;
  - **reset** — re-materialize to built-in spacing.

  Direct per-paragraph spacing edits remain on `block.style` and are treated as
  direct formatting (Google Docs parity).

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
