/**
 * Named paragraph styles — the Google Docs "Paragraph styles" model.
 *
 * A fixed catalog of nine styles (Normal text, Title, Subtitle, Heading 1–6)
 * whose definitions are redefinable per document. Users cannot create
 * arbitrary named styles (Google Docs parity).
 *
 * A block references its style implicitly through its existing `type` /
 * `headingLevel` fields (see `blockStyleId`), so no block-model change is
 * needed. The document carries a `styles` registry (`DocStyles`) holding only
 * *overrides* of the built-in definitions below; resolution deep-merges the
 * override over the built-in.
 *
 * Two resolution paths (see `docs/design/docs/docs-named-styles.md`):
 *  - Inline defaults (font/size/bold/italic/color) are applied lazily at
 *    layout time via `resolveStyleInline` (threaded into `resolveBlockInlines`).
 *    That resolution is *surface-aware*: the catalog's grayscale colors have a
 *    second, lighter value used when laying out for the dark page. It is an
 *    explicit argument that defaults to the light surface, never a global read,
 *    so export and the document-describing readers stay mode-blind.
 *  - Block spacing (marginTop/marginBottom/lineHeight) is resolved lazily at
 *    layout time via `effectiveBlockSpacing`, *and* materialized eagerly into
 *    `block.style` by the store when a style is applied/updated/reset, via
 *    `resolveStyleBlock`. The two agree by construction (both read the same
 *    registry); the eager write survives only because non-layout readers —
 *    the DOCX exporter, the backend docs-tree reader, `/api/v1` content GET —
 *    see `block.style` and have no registry in scope.
 *
 * The lazy path is what makes a heading that never went through the store's
 * materialize seam (DOCX/markdown import, paste, `/api/v1` PUT, the CLI,
 * templates, document copy) still render with its space-before and its own
 * leading. Before it existed, `computeLayout` and `assignLineHeights` read
 * `block.style` raw, so every such heading laid out with the
 * `DEFAULT_BLOCK_STYLE` 0 and 1.5 — the page had no vertical rhythm at all,
 * and a 26 pt Title was leaded exactly like 11 pt body text.
 */

import { DEFAULT_BLOCK_STYLE } from './types.js';
import type { Block, BlockStyle, Document, HeadingLevel, InlineStyle } from './types.js';

/**
 * Stable identifier for each built-in named style.
 */
export type StyleId =
  | 'normal'
  | 'title'
  | 'subtitle'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6';

/**
 * Which surface a style's inline defaults are being resolved *for*.
 *
 * Declared here rather than imported from `view/theme.ts`'s `ThemeMode` on
 * purpose: `model/` must not depend on `view/`, and the two are not the same
 * concept anyway — `ThemeMode` is the editor chrome's mode, `StyleSurface` is
 * a per-resolution argument that export paths deliberately never set.
 */
export type StyleSurface = 'light' | 'dark';

/**
 * Ordered list of all style ids — drives "reset all" and UI enumeration.
 */
export const STYLE_IDS: readonly StyleId[] = [
  'normal',
  'title',
  'subtitle',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
];

/**
 * A named-style definition: the inline (character) defaults and the block
 * (paragraph spacing) defaults that the style contributes.
 */
export interface NamedStyleDef {
  /** Character defaults — base layer under each inline's explicit style. */
  inline: Partial<InlineStyle>;
  /**
   * Character defaults applied *over* `inline` when the style is resolved for
   * a dark surface. Exists because the catalog's grayscale hierarchy is
   * expressed as literal hex — `#434343` / `#666666` are legible on white and
   * illegible on the `#2b2b2b` dark page (1.5:1 and 2.5:1, both far under the
   * 4.5:1 WCAG AA bar), and in dark mode a Heading 3 came out *darker* than
   * body text, inverting the hierarchy the greys exist to express.
   *
   * **Restricted to color keys, and it must stay that way.** Layout metrics
   * are resolved surface-blind on purpose (`assignLineHeights`,
   * `getLineMaxFontSizePx`), so a dark `fontSize` or `bold` would change the
   * painted glyphs without changing the measured line — page breaks, page
   * count and PDF output would then disagree with the screen. `Pick<>` is what
   * enforces that; do not widen it to `Partial<InlineStyle>`.
   */
  inlineDark?: Pick<InlineStyle, 'color' | 'backgroundColor'>;
  /**
   * Paragraph-level defaults the style owns: `marginTop`, `marginBottom` and
   * `lineHeight`. Resolved lazily at layout time by `effectiveBlockSpacing`,
   * and *also* materialized into `block.style` on apply for the readers with
   * no registry in scope (see the module header).
   */
  block: Partial<BlockStyle>;
}

/**
 * Per-document style registry — overrides only. An absent entry (or an absent
 * `inline`/`block` sub-key) resolves to the built-in default.
 */
export type DocStyles = Partial<Record<StyleId, Partial<NamedStyleDef>>>;

/**
 * Built-in style definitions, refreshed to Google Docs defaults.
 *
 * Spacing values are Google Docs point spacing converted to px at 96 dpi
 * (`px = pt × 4/3`, rounded).
 *
 * **Heading weight is not uniform, and the earlier claim here that it was is
 * false.** This block used to read "headings are intentionally non-bold:
 * visual hierarchy comes from size and grayscale color, matching Google Docs",
 * and `named-styles.test.ts` pinned it with a loop asserting every style's
 * `bold` was `undefined`. Google Docs' actual factory defaults, read out of a
 * `Format → Paragraph styles → Options → Reset styles` document's own
 * `word/styles.xml` export, are:
 *
 *     Title      26pt            before  0pt  after  3pt
 *     Subtitle   15pt  italic    before  0pt  after 16pt   #666666
 *     Heading 1  20pt            before 20pt  after  6pt
 *     Heading 2  16pt  BOLD      before 18pt  after  6pt
 *     Heading 3  14pt  BOLD      before 16pt  after  4pt   #434343
 *     Heading 4  12pt            before 14pt  after  4pt   #666666
 *     Heading 5  11pt            before 12pt  after  4pt   #666666
 *     Heading 6  11pt  italic    before 12pt  after  4pt   #666666
 *
 * So Google's ladder is *non-monotone in weight* — H1 is regular and the two
 * levels under it are bold. Odd, but it is what the product does, and the
 * catalog claims parity, so it is what we do. Two other values came back
 * wrong in the same audit and are fixed here: Subtitle's italic was missing,
 * and Subtitle's space-after was `16` — the raw **point** number copied into a
 * pixel field, the one place in this catalog where the pt→px conversion was
 * skipped (it is 16pt = 21px).
 *
 * `normal` carries no inline defaults — Arial 11pt #000000 comes from
 * `DEFAULT_INLINE_STYLE` / theme defaults at paint time — but it does carry
 * block spacing so that converting a heading back to a paragraph resets the
 * paragraph spacing.
 *
 * **Leading is uniform 1.15, matching Google Docs**, and the per-style ladder
 * that used to sit here (Title 1.1 … Normal 1.5) is deliberately gone. Its own
 * justification is what retired it: it argued that "held at 1.5, a 26 pt Title
 * gets a 52 px line box around 34.7 px of glyph and floats in air while the
 * body text below it, which needs that leading, gets the same ratio". True —
 * but only because `normal` was 1.5. Now that `normal` is Google's 1.15, one
 * multiplier gives the Title a 39.9 px box for the same 34.7 px of glyph, i.e.
 * 2.6 px of half-leading, and nothing floats. The ladder was a workaround for
 * a body default that no longer exists, so keeping it would have bought a
 * 1.7 px per-heading divergence from Google in exchange for nothing.
 *
 * **The greys come in pairs.** `inline.color` is the light-surface value —
 * Google Docs parity, and what PDF/DOCX export emits — and `inlineDark.color`
 * the value the same style resolves to when laid out for the `#2b2b2b` dark
 * page. A single shared grey is not merely undesirable but *impossible*: AA
 * (4.5:1) on white needs relative luminance ≤ 0.1833 and AA on `#2b2b2b`
 * needs ≥ 0.2837, and those intervals are disjoint. The AA-*large* 3:1 windows
 * do overlap, but only heading-3 could use them: at 14 pt bold it sits exactly
 * on WCAG's large-text threshold, while subtitle (15 pt) and heading-4/5/6
 * (12/11/11 pt, none bold) are normal-sized text and answer to 4.5:1. Since
 * one shared grey would have to satisfy every style, 4.5:1 is the binding bar
 * and a mode-dependent value is forced. (The pair chosen clears both bars on
 * every style anyway, so heading-3's large-text status buys no slack — it is
 * noted here only because the previous version of this comment claimed no
 * style was bold, which stopped being true when the catalog was corrected to
 * Google's real factory weights.) Measured
 * contrasts, light then dark: heading-3 `#434343` 9.89:1 / `#B0B0B0` 6.53:1;
 * subtitle + heading-4/5/6 `#666666` 5.74:1 / `#999999` 4.97:1. Both tiers
 * stay below body ink (16.24:1 light, 13.14:1 dark) so the hierarchy reads the
 * same way round in both modes — today's dark rendering inverts it, `#434343`
 * scoring 1.43:1 against a body text at 13.14:1. `named-styles.test.ts`
 * recomputes those ratios rather than trusting this comment.
 */
export const BUILTIN_STYLES: Record<StyleId, NamedStyleDef> = {
  'normal': { inline: {}, block: { marginTop: 0, marginBottom: 0, lineHeight: 1.15 } },
  'title': { inline: { fontSize: 26 }, block: { marginTop: 0, marginBottom: 4, lineHeight: 1.15 } },
  'subtitle': { inline: { fontSize: 15, color: '#666666', italic: true }, inlineDark: { color: '#999999' }, block: { marginTop: 0, marginBottom: 21, lineHeight: 1.15 } },
  'heading-1': { inline: { fontSize: 20 }, block: { marginTop: 27, marginBottom: 8, lineHeight: 1.15 } },
  'heading-2': { inline: { fontSize: 16, bold: true }, block: { marginTop: 24, marginBottom: 8, lineHeight: 1.15 } },
  'heading-3': { inline: { fontSize: 14, bold: true, color: '#434343' }, inlineDark: { color: '#B0B0B0' }, block: { marginTop: 21, marginBottom: 5, lineHeight: 1.15 } },
  'heading-4': { inline: { fontSize: 12, color: '#666666' }, inlineDark: { color: '#999999' }, block: { marginTop: 19, marginBottom: 5, lineHeight: 1.15 } },
  'heading-5': { inline: { fontSize: 11, color: '#666666' }, inlineDark: { color: '#999999' }, block: { marginTop: 16, marginBottom: 5, lineHeight: 1.15 } },
  'heading-6': { inline: { fontSize: 11, color: '#666666', italic: true }, inlineDark: { color: '#999999' }, block: { marginTop: 16, marginBottom: 5, lineHeight: 1.15 } },
};

/**
 * Map a block to the style that governs it. Derived from existing fields, so
 * no block-model migration is required. Non-text structural blocks
 * (horizontal-rule, table, page-break) and list items map to `normal`.
 */
export function blockStyleId(block: Block): StyleId {
  switch (block.type) {
    case 'title':
      return 'title';
    case 'subtitle':
      return 'subtitle';
    case 'heading': {
      // Clamp to 1–6: DOCX import (`docx-style-map.ts`) reads `Heading N` from
      // Word where N can be 7–9, so the raw level may fall outside our catalog.
      const level = Math.min(6, Math.max(1, block.headingLevel ?? 1)) as HeadingLevel;
      return `heading-${level}` as StyleId;
    }
    default:
      return 'normal';
  }
}

/**
 * Effective inline defaults for a style: built-in merged under any override,
 * with the built-in's dark-surface color layer applied in between when the
 * caller asks for the dark surface.
 *
 * **`surface` defaults to `'light'`, and that default is load-bearing.** It is
 * the whole mechanism by which every non-screen consumer stays mode-blind:
 *
 *  - PDF export (`export/pdf-exporter.ts`) omits it, so a document exported
 *    while the editor is in dark mode still prints the Google-Docs greys on
 *    white paper. It runs *client-side, in this same module instance*, after
 *    the editor has already called `setThemeMode('dark')`, so this cannot be
 *    a `getThemeMode()` read inside this function — that would silently bake
 *    `#B0B0B0` headings into the PDF. "Force light for the duration of the
 *    export" is no better: export yields cooperatively (`export/yield.ts`), so
 *    a concurrent editor repaint would flash light greys onto the dark canvas.
 *    A parameter with a light default is the only re-entrant-safe shape.
 *  - The document-describing readers — `model/caret-style.ts`,
 *    `model/range-runs.ts`, `model/document.ts` — omit it too, so the toolbar
 *    swatch and, critically, "Update Heading 3 to match" capture `#434343`
 *    even in dark mode. Dark-mode *presentation* must never be persisted into
 *    the CRDT style registry as an authored color.
 *
 * Only the layout chain (`resolveBlockInlines` ← `layoutBlock` ←
 * `computeLayout`/`computeTableLayout`) threads the argument, and only the
 * editor supplies a non-default value.
 *
 * The user override is spread **last and unconditionally**, so a style the
 * document has redefined paints that one color on both surfaces — a redefined
 * style belongs to the document, not to the product.
 *
 * That rule only holds up while the registry holds *deliberate* redefinitions.
 * The first cut of the dark layer treated the light-surface capture above as
 * sufficient on its own; it was not. "Update to match" captures the *computed*
 * style, so `#434343` reached the capture whether or not anybody chose it, and
 * storing it here — spread last, on both surfaces — put the illegible grey
 * straight back onto the dark page for a user who had only toggled Bold.
 * `omitBuiltinStyleDefaults` below is what keeps a value nobody chose out of
 * the override to begin with.
 */
export function resolveStyleInline(
  id: StyleId,
  docStyles?: DocStyles,
  surface: StyleSurface = 'light',
): Partial<InlineStyle> {
  // `?.` guards an unknown id (e.g. a corrupt persisted registry key) so
  // resolution degrades to built-in/empty instead of throwing in the layout
  // hot path. `blockStyleId` already clamps heading levels into range.
  return {
    ...BUILTIN_STYLES[id]?.inline,
    ...(surface === 'dark' ? BUILTIN_STYLES[id]?.inlineDark : undefined),
    ...docStyles?.[id]?.inline,
  };
}

/**
 * Effective block (spacing) defaults for a style: built-in merged under any
 * override.
 */
export function resolveStyleBlock(
  id: StyleId,
  docStyles?: DocStyles,
): Partial<BlockStyle> {
  return { ...BUILTIN_STYLES[id]?.block, ...docStyles?.[id]?.block };
}

/**
 * Drop the properties of `captured` that already equal `builtin`'s. Local
 * because the only sound caller is `omitBuiltinStyleDefaults` below — a
 * general "diff two styles" helper invites comparing against the *effective*
 * resolution, which is precisely the mistake documented there.
 *
 * A property whose captured value is `undefined` is dropped as well. The
 * capture spells out all ten character properties by name, so anything neither
 * the run nor the built-in sets arrives as an explicit `undefined` key — and
 * every persistence boundary the registry crosses (`JSON.stringify` in
 * `MemDocStore`, `root.stylesJson` in `YorkieDocStore`) already drops those, so
 * nothing is lost here that survived before.
 */
function omitEqual<T extends object>(captured: T, builtin: Partial<T>): T {
  const out = {} as T;
  for (const key of Object.keys(captured) as Array<keyof T>) {
    const value = captured[key];
    if (value === undefined) continue;
    if (Object.is(value, builtin[key])) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Reduce a definition *captured from a block* ("Update <style> to match") to
 * the properties the document actually redefined: every property whose value
 * is already what the built-in supplies is dropped rather than stored.
 *
 * **Why this is not cosmetic.** The capture is the *computed* style at the
 * caret — the run's explicit style layered over the built-in defaults — so
 * every property the run never set comes back carrying the built-in's own
 * value. Writing that whole object into `DocStyles` converts nine inherited
 * defaults into authored overrides on behalf of a user who chose one. The
 * registry then means "the document decided this", which is the assumption
 * `resolveStyleInline` is built on: it spreads the document override **last and
 * unconditionally**, on both surfaces, because a redefined style belongs to
 * the document rather than to the product.
 *
 * That is exactly how the dark surface was destroyed. `model/caret-style.ts`
 * resolves the capture on the light surface on purpose (dark-mode presentation
 * must never be persisted), so a user in dark mode who put the caret in a
 * Heading 3, toggled **Bold**, and clicked "Update Heading 3 to match" stored
 * `color: '#434343'` — the light grey they never picked and could not even see
 * — which then outranked `inlineDark` and painted every Heading 3 at 1.43:1 on
 * the `#2b2b2b` page: the inverted hierarchy the second color layer exists to
 * remove, reintroduced by a weight change. Only "Reset style" undid it, and
 * that dropped the bold too. Capturing on the light surface is necessary but,
 * on its own, was not sufficient; this is the other half.
 *
 * **Pruned against the built-in, never against the effective resolution.**
 * `updateStyleDefinition` replaces a style's whole entry, so a capture from a
 * Heading 1 the document has already redefined to 30 pt must keep the 30
 * (30 ≠ the built-in's 20 → kept). Comparing against
 * `resolveStyleInline(id, docStyles)` would drop it as "unchanged" and silently
 * revert the redefinition to 20 the next time anyone updated the style to match
 * after toggling italic.
 *
 * **Why a value comparison is sound here, when Fix 1 had to replace one.**
 * The block-spacing sentinel it replaced was unsound because its fallback was a
 * *different* number: a paragraph that authored `marginTop: 0` got the style's
 * 27. Here the fallback is the pruned value itself — dropping property `p` when
 * `p` equals the built-in leaves `resolveStyleInline` on the capture surface
 * bit-identical, because the built-in layer supplies exactly what was removed.
 * The only resolution that changes is the *other* surface's, and that change is
 * the entire point.
 *
 * The one user-visible consequence, stated rather than hidden: someone who
 * deliberately picks `#434343` — the catalog's own Heading 3 grey — and updates
 * the style to match gets `#B0B0B0` in dark mode rather than the frozen
 * `#434343`. Picking the value the style already has is indistinguishable from
 * not picking, and resolving it to the surface-appropriate grey is the better
 * reading of it. Any other color is stored and paints on both surfaces.
 *
 * `surface` must be the surface the capture was resolved on. It is `'light'`
 * by construction today (see `model/caret-style.ts`); the parameter exists so
 * that a future surface-aware capture cannot get here without saying so.
 */
export function omitBuiltinStyleDefaults(
  id: StyleId,
  captured: NamedStyleDef,
  surface: StyleSurface = 'light',
): NamedStyleDef {
  return {
    inline: omitEqual(captured.inline, resolveStyleInline(id, undefined, surface)),
    block: omitEqual(captured.block, resolveStyleBlock(id)),
  };
}

/**
 * The three style-owned block values a writer that knows nothing about named
 * styles produces — i.e. `DEFAULT_BLOCK_STYLE`'s. Derived from the constant
 * rather than written out, so the sentinel can never drift away from the
 * default.
 *
 * `BUILTIN_STYLES.normal.block` is deliberately *identical* to this triple.
 * That equality is load-bearing (asserted in `test/model/named-styles.test.ts`):
 * it is what makes `effectiveBlockSpacing` a provable no-op for every caller
 * that passes no registry — slides, board, and the shared text-box editor,
 * whose blocks are all `paragraph`/`list-item` and so resolve to `normal`.
 * Sentinel in, sentinel out. Changing `BUILTIN_STYLES.normal.block` would
 * silently move every slides/board paragraph's gaps and leading.
 *
 * The authored markers only strengthen that: `true` returns the block's own
 * value unconditionally (identity by construction, no equality needed), and
 * `false` is written by exactly one function — `materializeBlockSpacing` —
 * which slides/board never reach (no `setBlockType` on a slides text body, no
 * style registry, no `rematerializeDocSpacing`). So the equality above still
 * covers the one branch a slides/board block can take, and the marker branches
 * cannot move them at all.
 */
export const STYLE_OWNED_SPACING_DEFAULTS: BlockSpacing = {
  marginTop: DEFAULT_BLOCK_STYLE.marginTop,
  marginBottom: DEFAULT_BLOCK_STYLE.marginBottom,
  lineHeight: DEFAULT_BLOCK_STYLE.lineHeight,
};

/** Resolved vertical spacing (the style-owned block fields) for one block. */
export interface BlockSpacing {
  marginTop: number;
  marginBottom: number;
  /** Line-height multiplier of the line's tallest font size. */
  lineHeight: number;
}

/**
 * Neighbourhood a block is being resolved in. Only `list-item` blocks read it,
 * and only when `contextualListSpacing` is on.
 */
export interface BlockSpacingContext {
  /** The block immediately before this one in the same block list. */
  prev?: Block;
  /** The block immediately after this one in the same block list. */
  next?: Block;
  /**
   * Suppress the inter-item gap inside a run of adjacent `list-item` blocks.
   * Space then falls *around* the list rather than between every bullet, which
   * is what a list is: one block of content, not N paragraphs.
   *
   * The DOCX analogue is `<w:contextualSpacing/>` ("Don't add space between
   * paragraphs of the same style"), but the two rules are **not the same
   * predicate** and conflating them shipped a bug. This one keys on block
   * *type* adjacency (`list-item` next to `list-item`); Word's keys on
   * paragraph *style* identity, and every paragraph an export writes was
   * unstyled `Normal` — so Word also ate the gap after the last bullet.
   * `export/docx-style-map.ts` reconciles them by giving list items their own
   * `ListParagraph` style; see its `opts.listItem` comment.
   *
   * **Opt-in, and docs-only.** Slides/board text bodies lay out through the
   * same `computeLayout`, and a slide bullet seeded by `seedPlaceholderBlocks`
   * carries the very same inherited `marginBottom: 8`. Turning this on for
   * them would move every slide's visual baselines, its autofit-shrink scale
   * and its auto-grown table rows — so the docs editor, the PDF exporter and
   * the CLI paginator pass the flag and nothing else does. (Slides bullets
   * arguably want it too; that is a follow-up with its own baselines to
   * re-approve, not a side effect of this one.)
   */
  contextualListSpacing?: boolean;
  /**
   * Whether `normal`'s catalog spacing applies. **Docs-only, opt-in**, and the
   * reason `normal` is the one style whose values are not simply read.
   *
   * Google Docs leads body text at 1.15 with no space after a paragraph; this
   * catalog now says the same, because a measured comparison against a
   * factory-reset Google document put every heading within 1.7 px and every
   * *body* paragraph 13.1 px out (22.0 px line box vs 16.9, plus an 8 px gap
   * Google does not have) — 23 % of the document's height, and all of it here.
   *
   * But `normal` is also what every slides/board paragraph maps to
   * (`blockStyleId`), and those hosts pass no registry, so before this flag the
   * invariant that kept them untouched was `normal`'s block values being
   * *identical* to `DEFAULT_BLOCK_STYLE`'s. Moving `normal` to Google's numbers
   * breaks that invariant by construction. The flag restores it: a host that
   * does not set it falls back to `STYLE_OWNED_SPACING_DEFAULTS` for `normal`
   * — today's 0 / 8 / 1.5 — so every deck lays out exactly as before, while
   * headings (which slides also uses) keep resolving from the catalog.
   *
   * Failing closed matters here: a slides call site that forgot to opt *out*
   * would silently reflow every deck, its autofit scale and its auto-grown
   * table rows. Only `DOCS_LAYOUT_OPTIONS` turns it on.
   */
  normalStyleSpacing?: boolean;
}

/**
 * The three fields a named style owns, paired with the `BlockStyle` boolean
 * that records whether the paragraph authored each one. Iterated by
 * `markAuthoredSpacing` / `clearAuthoredSpacing`; `effectiveBlockSpacing`
 * spells the three out so its result type stays a plain `BlockSpacing`.
 */
export const STYLE_OWNED_SPACING_MARKERS = {
  marginTop: 'authoredMarginTop',
  marginBottom: 'authoredMarginBottom',
  lineHeight: 'authoredLineHeight',
} as const;

/**
 * Stamp a block-style *patch* with the authored markers its own fields imply:
 * a patch that sets `lineHeight` says "this paragraph authored its leading",
 * and says nothing about the margins it does not mention.
 *
 * Called from the single funnel every interactive block-style write passes
 * through (`DocsDocument.applyBlockStyle`) rather than from the toolbar,
 * precisely so no control has to remember: the failure mode of a per-call-site
 * marker is one writer forgetting and silently reintroducing the bug.
 *
 * A patch that carries no spacing at all — `indent`/`outdent` pass only
 * `marginLeft`, alignment passes only `alignment` — is returned with nothing
 * added, so it cannot claim authorship of spacing it never touched. An explicit
 * marker already in the patch wins, which is how a caller un-authors a field.
 */
export function markAuthoredSpacing(
  style: Partial<BlockStyle>,
): Partial<BlockStyle> {
  const marked: Partial<BlockStyle> = { ...style };
  const fields = Object.keys(STYLE_OWNED_SPACING_MARKERS) as Array<keyof BlockSpacing>;
  for (const field of fields) {
    const marker = STYLE_OWNED_SPACING_MARKERS[field];
    if (marker in style) continue;
    const value = style[field];
    if (typeof value === 'number' && Number.isFinite(value)) marked[marker] = true;
  }
  return marked;
}

/**
 * The inverse: all three markers explicitly `false`, i.e. "this paragraph
 * authored none of its spacing — the named style supplies all of it".
 *
 * Explicit `false` rather than deleted keys because the markers travel as CRDT
 * Tree attributes and `Tree.styleByPath` merges: see `crdt-attrs.ts`.
 */
export function clearAuthoredSpacing(): Pick<
  BlockStyle,
  'authoredMarginTop' | 'authoredMarginBottom' | 'authoredLineHeight'
> {
  return {
    authoredMarginTop: false,
    authoredMarginBottom: false,
    authoredLineHeight: false,
  };
}

/**
 * The spacing a block should actually lay out with: its named style's value
 * when the block carries no *authored* spacing, its own value otherwise.
 *
 * Per field, in order:
 *
 *  1. **`authored*` marker present** — believe it. `true` returns the block's
 *     own value verbatim, 0 and 1.5 included; `false` returns the style's.
 *     This is the real signal (`BlockStyle`), and it is what makes a Word
 *     paragraph carrying `<w:spacing w:before="0"/>` or an editor paragraph
 *     whose leading was set to exactly 1.5 keep the value its author chose.
 *  2. **Marker absent** — a legacy block, or one written by a path that
 *     predates the marker. `BlockStyle.marginTop`/`marginBottom`/`lineHeight`
 *     are required numbers that every writer seeds from `DEFAULT_BLOCK_STYLE`,
 *     so there is no absence to key on, in memory or on the wire. Fall back to
 *     the value sentinel: **a spacing field that still carries what a
 *     style-unaware writer would have produced carries no information, so the
 *     style supplies it; anything else is direct paragraph formatting and
 *     wins.** That is what repairs every already-persisted document at the next
 *     repaint with zero CRDT writes and no migration.
 *
 * Why the fallback is safe rather than a magic number:
 *  - It agrees with the eager `materializeBlockSpacing` write for every
 *    built-in and every override, because both read `resolveStyleBlock`. A
 *    materialized heading and a legacy one of the same type render
 *    identically — which is exactly the defect being fixed.
 *  - It is inert for slides/board (see `STYLE_OWNED_SPACING_DEFAULTS`).
 *
 * The residual cost, stated rather than hidden: a block whose marker is absent
 * *and* whose author genuinely meant the default value still loses — a
 * `/api/v1` content PUT written before the marker existed, or one from an older
 * client, that deliberately puts `marginTop: 0` on a heading renders with the
 * style's 27. Every writer in this repo now stamps the marker (the DOCX
 * importer, the interactive funnel, the docs→docs clipboard, both stores), so
 * this narrows to blocks already persisted and to genuinely older peers, where
 * it is the behaviour that repairs them.
 *
 * `??` guards the `{}` that `resolveStyleBlock` returns for a corrupt style id.
 */
/**
 * An *authored* spacing field, guarded against a `BlockStyle` that does not
 * actually carry the number its type promises.
 *
 * `BlockStyle` is a persisted shape — it arrives from the CRDT, the content
 * PUT API, and DOCX/PPTX import — so `marginTop: number` is a claim rather
 * than a guarantee, and a caller that hand-builds a block without going
 * through `normalizeBlockStyle` produces the same hole. An `undefined` that
 * flows on from here reaches `Math.max(1, lineHeight)` in `assignLineHeights`
 * as `NaN`, which is a line box of NaN height — a document that paints
 * nothing rather than one that paints wrongly.
 *
 * Layout used to carry this defence itself (`block.style.lineHeight ?? 1.5`).
 * Moving spacing resolution in here moved the responsibility with it, so the
 * guard has to live here too; the inherited branches are already covered by
 * their own `??`.
 */
function authoredOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

export function effectiveBlockSpacing(
  block: Block,
  docStyles?: DocStyles,
  ctx?: BlockSpacingContext,
): BlockSpacing {
  const styleId = blockStyleId(block);
  // `normal` is the one style a host can decline. See
  // `BlockSpacingContext.normalStyleSpacing`: its catalog values are Google's
  // body rhythm, which is right for a document and wrong for a slide, and
  // slides/board reach this function through the same `computeLayout`.
  // Declining yields exactly `DEFAULT_BLOCK_STYLE`'s numbers, so an opted-out
  // host resolves every unauthored field back to the value it already had —
  // the identity that kept `effectiveBlockSpacing` a no-op for them.
  const styleBlock =
    styleId === 'normal' && !ctx?.normalStyleSpacing
      ? STYLE_OWNED_SPACING_DEFAULTS
      : resolveStyleBlock(styleId, docStyles);

  // Per field: is the value inherited from the style (→ the style supplies it)
  // or authored by this paragraph (→ it wins)? Tracked, not just resolved,
  // because the contextual list rule below may only touch *inherited* spacing —
  // flattening an authored gap would silently rewrite paragraphs pasted into a
  // list.
  const inheritedTop = !(block.style.authoredMarginTop
    ?? block.style.marginTop !== STYLE_OWNED_SPACING_DEFAULTS.marginTop);
  const inheritedBottom = !(block.style.authoredMarginBottom
    ?? block.style.marginBottom !== STYLE_OWNED_SPACING_DEFAULTS.marginBottom);
  const inheritedLine = !(block.style.authoredLineHeight
    ?? block.style.lineHeight !== STYLE_OWNED_SPACING_DEFAULTS.lineHeight);

  let marginTop = inheritedTop
    ? styleBlock.marginTop ?? STYLE_OWNED_SPACING_DEFAULTS.marginTop
    : authoredOr(block.style.marginTop, STYLE_OWNED_SPACING_DEFAULTS.marginTop);
  let marginBottom = inheritedBottom
    ? styleBlock.marginBottom ?? STYLE_OWNED_SPACING_DEFAULTS.marginBottom
    : authoredOr(block.style.marginBottom, STYLE_OWNED_SPACING_DEFAULTS.marginBottom);
  const lineHeight = inheritedLine
    ? styleBlock.lineHeight ?? STYLE_OWNED_SPACING_DEFAULTS.lineHeight
    : authoredOr(block.style.lineHeight, STYLE_OWNED_SPACING_DEFAULTS.lineHeight);

  // Contextual list spacing: a bullet with a bullet above it opens no gap, and
  // one with a bullet below it closes none. The run's first item keeps its
  // space-before and its last its space-after, so the list as a whole is
  // separated from the surrounding paragraphs exactly as one paragraph would
  // be. A single-item list is untouched (it both starts and ends the run).
  //
  // Adjacency of `Block.type` is the whole test — list kind and nesting level
  // are deliberately not consulted, so a bullet followed by a number still
  // reads as one run.
  //
  // It is **not** a named-style test, and the earlier comment here claiming it
  // was equivalent to one was false in a way that shipped a bug: it read
  // "every list item maps to `normal` (`blockStyleId`), so Word's 'paragraphs
  // of the same style' is exactly 'the neighbour is also a bullet'". The
  // premise is right and the conclusion inverts it — `blockStyleId` maps
  // *paragraphs* to `normal` too, so style identity holds across the
  // bullet/paragraph boundary and would zero the gap after the last item of
  // every list. The screen never had that bug (this code keys on `type`); the
  // DOCX export did, until list items got their own `ListParagraph` style.
  // See `export/docx-style-map.ts`.
  if (ctx?.contextualListSpacing && block.type === 'list-item') {
    if (inheritedTop && ctx.prev?.type === 'list-item') marginTop = 0;
    if (inheritedBottom && ctx.next?.type === 'list-item') marginBottom = 0;
  }

  return { marginTop, marginBottom, lineHeight };
}

/**
 * Materialize a single block's spacing from its style. Returns a new
 * `BlockStyle` with the style's block defaults applied over the block's
 * current style — preserving direct paragraph formatting (alignment, indent)
 * while resetting the style-owned fields.
 *
 * `lineHeight` is one of those style-owned fields now, so applying a style
 * resets line spacing along with the margins. That is Google Docs' behaviour
 * ("applying a paragraph style clears direct paragraph formatting"), and it is
 * also what keeps this eager path in agreement with the lazy
 * `effectiveBlockSpacing` — the two read the same `resolveStyleBlock`, so a
 * heading typed in the browser and one that arrived by import must lay out
 * identically. `test/model/named-styles.test.ts` pins that across all nine
 * built-ins.
 *
 * It also **clears** the authored markers, and that direction matters. This
 * function's contract is "this paragraph's style-owned spacing is now the
 * style's, not the paragraph's" — so the marker it leaves behind must say
 * *inherited*. Setting them instead would pin every materialized block to the
 * literal it happened to be materialized with, which is invisible while
 * `writeStylesAndRematerialize` keeps re-syncing values on every redefinition
 * but breaks the moment a block leaves that loop: copy a Heading 1
 * (materialized `mt=27`) into a document whose Heading 1 is redefined to 40 and
 * it would show 27 forever, since neither `POST /documents/:id/copy` nor an
 * `/api/v1` PUT rematerializes. A cleared marker is also strictly stronger than
 * the value sentinel it replaces — "the style supplies this" no longer depends
 * on the value happening to equal the default.
 */
export function materializeBlockSpacing(
  block: Block,
  docStyles?: DocStyles,
): BlockStyle {
  return {
    ...block.style,
    ...resolveStyleBlock(blockStyleId(block), docStyles),
    ...clearAuthoredSpacing(),
  };
}

/**
 * Re-materialize block spacing in place across a document's body, header/footer,
 * and table-cell blocks (recursively, including nested tables). Pass a `styleId`
 * to limit it to blocks governed by that style; omit it to re-materialize every
 * styled block (used by "Reset styles"). Reads the spacing from `doc.styles`.
 *
 * Cells are walked so a styled paragraph inside a table cell tracks spacing
 * changes the same way its inline defaults already reflow (the inline cascade
 * reaches cells via `computeTableLayout`).
 */
export function rematerializeDocSpacing(doc: Document, styleId?: StyleId): void {
  const apply = (blocks: Block[]) => {
    for (const block of blocks) {
      if (!styleId || blockStyleId(block) === styleId) {
        block.style = materializeBlockSpacing(block, doc.styles);
      }
      if (block.tableData) {
        for (const row of block.tableData.rows) {
          for (const cell of row.cells) {
            apply(cell.blocks);
          }
        }
      }
    }
  };
  apply(doc.blocks);
  if (doc.header) apply(doc.header.blocks);
  if (doc.footer) apply(doc.footer.blocks);
}
