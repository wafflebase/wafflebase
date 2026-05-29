/**
 * Minimal editor interface the shared text-formatting components depend on.
 *
 * Both `EditorAPI` (docs full editor) and the extended `TextBoxEditorAPI`
 * (slides text-box, after the Commit A promotion) satisfy this interface
 * structurally — TypeScript structural typing is relied on here; no explicit
 * `implements` declaration is needed on either side.
 *
 * Keep this surface small: only the methods the three shared components
 * (`TextStyleGroup`, `TextFormatGroup`, `TextParagraphGroup`) actually call.
 * Docs-specific methods (table ops, image insert, export, etc.) stay on the
 * full `EditorAPI` and are not part of this interface.
 */

import type { InlineStyle, BlockStyle, BlockType, HeadingLevel } from "@wafflebase/docs";

export interface TextFormattingEditor {
  /** Focus the underlying editor after a toolbar click. */
  focus(): void;

  /** Get the inline style at the current cursor/selection anchor. */
  getSelectionStyle(): Partial<InlineStyle>;

  /**
   * Summary of inline styles across the current selection. For each key,
   * returns the resolved value when uniform, the literal `'mixed'` when
   * the selection contains more than one value for that key, or
   * `undefined` when the property is unset throughout. With no selection,
   * returns the style at the cursor (same shape as `getSelectionStyle`).
   * The `color` / `backgroundColor` types match the docs `EditorAPI`
   * (`InlineStyle['color']`, i.e. `StoredColor | undefined`) so docs and
   * slides editors structurally satisfy this interface without casts.
   */
  getRangeStyleSummary(): {
    bold?: boolean | "mixed";
    italic?: boolean | "mixed";
    underline?: boolean | "mixed";
    strikethrough?: boolean | "mixed";
    fontFamily?: string | "mixed";
    fontSize?: number | "mixed";
    color?: InlineStyle["color"] | "mixed";
    backgroundColor?: InlineStyle["backgroundColor"] | "mixed";
    superscript?: boolean | "mixed";
    subscript?: boolean | "mixed";
  };

  /** Apply inline style to the current selection. */
  applyStyle(style: Partial<InlineStyle>): void;

  /** Remove every inline style attribute on the current selection. */
  clearInlineFormatting(): void;

  /** Apply block style to blocks in the current selection. */
  applyBlockStyle(style: Partial<BlockStyle>): void;

  /** Get the block type at the cursor position. */
  getBlockType(): {
    type: BlockType;
    headingLevel?: HeadingLevel;
    listKind?: "ordered" | "unordered";
    listLevel?: number;
  };

  /**
   * Read the inline style at the cursor for the current block. Optional
   * so existing slides text-box implementations that don't yet expose it
   * keep type-checking; both the docs `EditorAPI` and the slides
   * `SlidesTextBoxEditor` satisfy it structurally.
   */
  getBlockStyle?(): Partial<BlockStyle>;

  /** Set the block type for the block at cursor. */
  setBlockType(
    type: BlockType,
    opts?: {
      headingLevel?: HeadingLevel;
      listKind?: "ordered" | "unordered";
      listLevel?: number;
    }
  ): void;

  /** Toggle list type on the block at cursor. */
  toggleList(kind: "ordered" | "unordered"): void;

  /** Increase indent of blocks in the current selection. */
  indent(): void;

  /** Decrease indent of blocks in the current selection. */
  outdent(): void;

  /** Programmatically trigger the link request (same as Ctrl+K). */
  requestLink(): void;

  /**
   * Strip all character-level inline styles (bold, italic, underline,
   * strikethrough, super/subscript, font size, font family, color,
   * background color, href) from the current selection. Block-level
   * style is preserved. No-op when nothing is selected.
   */
  clearInlineFormatting(): void;
}
