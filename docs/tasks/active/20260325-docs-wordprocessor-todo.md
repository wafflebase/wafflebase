# Docs Word Processor Roadmap — Task Tracking

Design doc: [docs-wordprocessor-roadmap.md](../../design/docs/docs-wordprocessor-roadmap.md)

## Phase 1: Block Type Extensions ✅

- [x] 1.1 Heading (H1–H6) — data model, layout, rendering, toolbar dropdown
- [x] 1.2 List (Ordered/Unordered) — data model, marker rendering, Tab level control
- [x] 1.3 Horizontal Rule — data model, rendering, `---` auto-convert
- [x] 1.4 Title / Subtitle — data model, style defaults, dropdown
- [x] 1.5 Layout engine block-type branching + justify alignment
- [x] 1.6 Yorkie serialization / deserialization + backward compatibility
- [x] 1.7 Toolbar grouping (Undo/Redo | Styles | Font Styles | Block Styles)
- [x] 1.8 Highlight color (backgroundColor) — pulled forward from Phase 2
- [x] 1.9 Keyboard shortcuts — align (⌘⇧L/E/R/J), indent (⌘]/[), lists (⌘⇧7/8), headings (⌘⌥0-6)
- [x] 1.10 Shortcut hints in toolbar tooltips and dropdown items

## Phase 2: Inline Extensions & Clipboard ✅

- [x] 2.1 Hyperlink — href, popover, Ctrl+K, URL auto-detect
- [x] 2.2 Background Color (Highlight) — *completed in Phase 1*
- [x] 2.3 Superscript / Subscript — font scaling, baseline offset
- [x] 2.4 Clipboard — internal formatted copy/paste, external HTML parsing, format painting
- [x] 2.5 Find & Replace — search bar, match highlight, replace

## Phase 3: Complex Blocks

- [x] 3.1 Image — insert, resize, alignment, backend storage
- [x] 3.2 Table — data model, cell editing, row/column CRUD, cell merge
- [ ] 3.3 Code Block — monospace, background color, ``` auto-convert

## Phase 4: Page Features

- [x] 4.1 Header / Footer — fixed regions, page numbers
- [x] 4.2 Page Break — Ctrl+Enter, forced split
- [ ] 4.3 Section Break — per-section PageSetup
- [ ] 4.4 Table of Contents — heading-based auto-generation, outline sidebar

## Phase 5: Advanced Collaboration

- [x] 5.1 Comments — text anchors, threads, resolve / reopen
- [ ] 5.2 Suggestion Mode — change tracking, accept / reject
- [ ] 5.3 Version History — snapshot list, preview, restore

## Phase 6: Advanced Features

- [ ] 6.1 Multi-Column Layout
- [ ] 6.2 Footnotes / Endnotes
- [ ] 6.3 Spell Check
- [x] 6.4 Print / PDF Export
- [x] **6.5 Named Styles** — Google Docs paragraph-style model: redefinable per-document registry (Normal/Title/Subtitle/Heading 1–6), Update to match / Reset, refreshed GS built-in values, per-user default styles. See [20260629-docs-named-styles-todo.md](20260629-docs-named-styles-todo.md)
- [x] 6.6 Full Keyboard Shortcuts mapping — single catalog (`shortcuts-catalog.ts`) + shared help modal (⌘/Ctrl+/); catalog drift fixed (heading 1–6, paste-formatting, word nav/delete now exposed). See [20260628-docs-shortcuts-catalog-todo.md](20260628-docs-shortcuts-catalog-todo.md)

---

## Parity Gap Backlog — Google Docs / MS Word audit (2026-07-01)

Audited the current docs package against the Google Docs **Insert / Format /
Tools** menus and the MS Word **Insert / Layout / References / Review** ribbons,
cross-referenced with an inventory of what `packages/docs/src` actually ships.
The Phase 1–6 tracker above stays as the historical record; the items below are
the *remaining* parity surface, grouped the way the two products group them.

Legend: `[ ]` open · `[~]` partial (engine/model exists, UI missing) ·
`(GS)` Google Docs · `(W)` MS Word · `(both)` present in both.

### A. Insert surface

Wafflebase has no `Insert` menu — insertion is scattered across the single
formatting toolbar. These are content types Google Docs / Word can insert that
Wafflebase cannot:

- [ ] A.1 **Special characters / symbol picker** (both) — searchable Unicode
  grid (Insert → Special characters). No symbol or emoji insertion exists today.
- [ ] A.2 **Emoji insert** (GS `@`-menu / both) — emoji picker, optionally an
  `:shortcode:` auto-replace.
- [ ] A.3 **Equation / math editor** (both) — inline math with the GS equation
  toolbar (Greek, operators, relations) or Word's OMML editor. New inline kind
  + render path; consider MathML/LaTeX serialization for DOCX round-trip.
- [ ] A.4 **Drawing / shapes / text box** (both) — anchored shapes, lines, and
  text boxes. Large item; the slides package already has a shape/path registry
  (`packages/slides/src/`) worth reusing rather than rebuilding.
- [ ] A.5 **Chart insert** (both) — reuse the sheets chart registry
  (`docs/design/sheets/charts.md`) as an embedded/linked image.
- [ ] A.6 **Bookmark + internal link / cross-reference** (both) — named anchors,
  link-to-heading/bookmark in the link popover, Word-style "Cross-reference".
  Pairs with Table of Contents (Phase 4.4).
- [ ] A.7 **Watermark** (both, Word Design tab / GS via drawing) — text/image
  watermark behind page content; needs a page-level render layer.
- [~] A.8 **Page count token** — page-number token ships in header/footer
  (`insertPageNumber`); the "Page X of Y" count token is not yet available.

### B. Format / paragraph / page controls

- [~] B.1 **Page Setup dialog** (both) — paper size / orientation / margins are
  fully modeled (`PageSetup`, `store.setPageSetup`) but **no UI exposes them**.
  Highest-value quick win: a File → Page setup dialog over the existing model.
- [ ] B.2 **Page color / background** (both) — extend `PageSetup` + paginated
  renderer with a page fill color.
- [~] B.3 **Hanging indent + numeric indent control** (both) — first-line indent
  already ships: the ruler draws a draggable first-line triangle over
  `BlockStyle.textIndent` (`view/ruler/index.ts` `drawDownTriangle` + drag →
  `indentChangeCb`), and it round-trips DOCX. Still missing: an explicit
  *hanging-indent* affordance, a right-indent ruler marker, and a numeric/menu
  indent entry (Format → Align & indent → Indentation options).
- [ ] B.4 **Tab stops** (both) — ruler-set tab stops (left/center/right/decimal).
  No `tabStops` in `BlockStyle` yet; DOCX style-map has a placeholder only.
- [~] B.5 **Paragraph spacing UI** (both) — `marginTop` / `marginBottom` (space
  before/after) exist in the model; only line-spacing has a control.
- [ ] B.6 **Bullets & numbering customization** (both) — choose marker glyph /
  number format / restart numbering. Today list markers are fixed per level.
- [ ] B.7 **Text direction / RTL** (both) — paragraph-level direction; out of
  scope for v1 unless an RTL locale is prioritized.

### C. Tools / navigation

- [ ] C.1 **Word count** (both) — words / characters / pages, with a live
  selection count. Small, high-visibility (Tools → Word count, ⌘⇧C in GS).
- [ ] C.2 **Document outline / navigation pane** (both) — heading-tree side
  panel with click-to-scroll. Shares heading extraction with ToC (Phase 4.4).
- [ ] C.3 **AutoCorrect / Substitutions** (both, GS Tools → Preferences) —
  smart quotes, `--`→em-dash, `(c)`→©, custom text substitutions. Markdown
  shortcuts (`#`, `*`, `` ``` ``) already exist; generalize into a substitution
  engine.
- [ ] C.4 **Citations & bibliography** (both) — source manager, in-text
  citations (APA/MLA/Chicago), generated bibliography. Large; research-doc tier.
- [ ] C.5 **Dictionary / Define** (GS) — inline definition lookup popover.
- [ ] C.6 **Compare documents** (both) — diff two revisions into tracked changes;
  depends on Suggestion Mode (Phase 5.2).

### D. Smart content (Google Docs–specific)

- [ ] D.1 **Smart chips** (GS) — people / date / file / dropdown / place chips
  via the `@` menu. Dropdown chips are the most generally useful.
- [ ] D.2 **Document tabs** (GS) — left-panel tabs that split one document into
  sections. Significant data-model + navigation work.
- [ ] D.3 **Building blocks / templates** (GS) — meeting notes, email draft,
  product roadmap, and table templates inserted from the `@` menu.

### E. View / structure

Wafflebase stays toolbar-driven (no Google-Docs/Word menu bar — it does not fit
our UX); new insert/format/tools actions surface through the existing toolbar,
context menus, and `@`-style pickers rather than a top menu bar.

- [ ] E.1 **Show formatting marks** (both) — toggle pilcrows / spaces / tabs /
  page breaks. Cheap once a non-printing-glyph render pass exists.
- [ ] E.2 **Pageless mode** (GS) — continuous no-page-boundary view. The layout
  engine is page-based today; this is a render-mode branch.

### F. Import / Export

- [~] F.1 **Markdown export** — `serialize/markdown.ts` exists in the engine but
  is **not wired** to the Export dropdown. Quick win.
- [~] F.2 **Plain-text export** — `serialize/text.ts` likewise exists, unwired.
- [ ] F.3 **Markdown import** — no importer; pairs with C.3 substitution work.

### G. Review / collaboration (already tracked above, restated for parity map)

- Suggestion / track-changes mode → **Phase 5.2** (still open).
- Version history → **Phase 5.3** (still open).
- Comments → shipped (Phase 5.1).

### Non-goals (explicitly out of scope per roadmap)

Carried from the design doc's Non-Goals plus AI/voice features that depend on
external services: Google Drive integration & add-on marketplace, offline
editing, native mobile apps, **voice typing**, **AI/Gemini writing & audio
overviews**, **translate document**, and **mail merge**. Also a non-goal: a
**Google-Docs/Word menu bar** (File/Edit/View/Insert/Format/Tools) — Wafflebase
stays toolbar-driven and surfaces actions through the toolbar, context menus,
and `@`-style pickers.

### Suggested sequencing for the next pull

1. **Quick wins over existing models** — B.1 Page Setup dialog, F.1/F.2
   Markdown & plain-text export wiring, C.1 Word count, B.3/B.5 indent &
   spacing controls.
2. **Discoverability** — E.1 formatting marks; surface new actions through the
   existing toolbar / context menus / `@`-pickers (no menu bar).
3. **High-value content** — A.1/A.2 special chars & emoji, A.6 bookmarks +
   Phase 4.4 ToC/outline (C.2), A.3 equations.
4. **Large items** — A.4 drawing/shapes (reuse slides), C.4 citations,
   D.1–D.3 smart content, Phase 5.2 suggestion mode.
