/**
 * Shared resolver for the three-case FontSize picker value:
 *   - selection has a uniform numeric size → that number
 *   - selection mixes multiple sizes (`'mixed'`)           → undefined (picker shows empty)
 *   - selection runs have no explicit size (`undefined`)   → DEFAULT_INLINE_STYLE.fontSize
 *
 * The undefined-run case maps to the docs default rather than empty
 * because both the docs renderer and the slides canvas paint sparse
 * inlines at `DEFAULT_INLINE_STYLE.fontSize` — so this value matches
 * what the user sees on the page.
 *
 * Subscribes to `onCursorMove` so the picker re-renders as the caret
 * moves between runs with different sizes. The hook accepts any editor
 * shape that exposes the two methods structurally (docs `EditorAPI`,
 * slides `SlidesTextBoxEditor`); callers do not need to import a
 * concrete editor type.
 */

import { useEffect, useState } from "react";
import { DEFAULT_INLINE_STYLE } from "@wafflebase/docs";

export interface FontSizeSource {
  getRangeStyleSummary(): { fontSize?: number | "mixed" };
  onCursorMove(cb: () => void): () => void;
}

export function useResolvedFontSize(
  editor: FontSizeSource | null,
): number | undefined {
  const [summary, setSummary] = useState<{ fontSize?: number | "mixed" }>(
    () => (editor ? editor.getRangeStyleSummary() : {}),
  );
  useEffect(() => {
    if (!editor) return;
    const refresh = (): void => setSummary(editor.getRangeStyleSummary());
    refresh();
    return editor.onCursorMove(refresh);
  }, [editor]);
  if (summary.fontSize === "mixed") return undefined;
  return summary.fontSize ?? DEFAULT_INLINE_STYLE.fontSize;
}
