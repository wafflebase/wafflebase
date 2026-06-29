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
 *  - Block spacing (marginTop/marginBottom) is materialized eagerly into
 *    `block.style` by the store when a style is applied/updated/reset, via
 *    `resolveStyleBlock`.
 */

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
  /** Paragraph spacing materialized into `block.style` on apply. */
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
 * Headings are intentionally **non-bold**: visual hierarchy comes from size
 * and grayscale color, matching Google Docs. Spacing values are Google Docs
 * point spacing converted to px at 96 dpi (`px = pt × 4/3`, rounded).
 *
 * `normal` carries no inline defaults — Arial 11pt #000000 comes from
 * `DEFAULT_INLINE_STYLE` / theme defaults at paint time — but it does carry
 * block spacing so that converting a heading back to a paragraph resets the
 * paragraph spacing.
 */
export const BUILTIN_STYLES: Record<StyleId, NamedStyleDef> = {
  'normal': { inline: {}, block: { marginTop: 0, marginBottom: 8 } },
  'title': { inline: { fontSize: 26 }, block: { marginTop: 0, marginBottom: 4 } },
  'subtitle': { inline: { fontSize: 15, color: '#666666' }, block: { marginTop: 0, marginBottom: 16 } },
  'heading-1': { inline: { fontSize: 20 }, block: { marginTop: 27, marginBottom: 8 } },
  'heading-2': { inline: { fontSize: 16 }, block: { marginTop: 24, marginBottom: 8 } },
  'heading-3': { inline: { fontSize: 14, color: '#434343' }, block: { marginTop: 21, marginBottom: 5 } },
  'heading-4': { inline: { fontSize: 12, color: '#666666' }, block: { marginTop: 19, marginBottom: 5 } },
  'heading-5': { inline: { fontSize: 11, color: '#666666' }, block: { marginTop: 16, marginBottom: 5 } },
  'heading-6': { inline: { fontSize: 11, color: '#666666', italic: true }, block: { marginTop: 16, marginBottom: 5 } },
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
 * Effective inline defaults for a style: built-in merged under any override.
 */
export function resolveStyleInline(
  id: StyleId,
  docStyles?: DocStyles,
): Partial<InlineStyle> {
  // `?.` guards an unknown id (e.g. a corrupt persisted registry key) so
  // resolution degrades to built-in/empty instead of throwing in the layout
  // hot path. `blockStyleId` already clamps heading levels into range.
  return { ...BUILTIN_STYLES[id]?.inline, ...docStyles?.[id]?.inline };
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
 * Materialize a single block's spacing from its style. Returns a new
 * `BlockStyle` with the style's block (spacing) defaults applied over the
 * block's current style — preserving direct paragraph formatting (alignment,
 * indent, lineHeight) while resetting the style-owned spacing fields.
 */
export function materializeBlockSpacing(
  block: Block,
  docStyles?: DocStyles,
): BlockStyle {
  return { ...block.style, ...resolveStyleBlock(blockStyleId(block), docStyles) };
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
