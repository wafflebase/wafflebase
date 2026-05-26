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

  /** Apply inline style to the current selection. */
  applyStyle(style: Partial<InlineStyle>): void;

  /** Apply block style to blocks in the current selection. */
  applyBlockStyle(style: Partial<BlockStyle>): void;

  /** Get the block type at the cursor position. */
  getBlockType(): {
    type: BlockType;
    headingLevel?: HeadingLevel;
    listKind?: "ordered" | "unordered";
    listLevel?: number;
  };

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
}
