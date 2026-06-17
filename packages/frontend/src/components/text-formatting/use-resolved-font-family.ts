/**
 * Shared resolver for the FontFamily picker value, mirroring
 * `useResolvedFontSize`:
 *   - selection has a uniform family            → that family
 *   - selection mixes families (`'mixed'`)       → undefined (picker shows —)
 *   - selection runs have no explicit family     → DEFAULT_INLINE_STYLE.fontFamily
 *
 * The undefined-run case maps to the docs default because both the docs
 * renderer and the slides canvas paint sparse inlines at
 * `DEFAULT_INLINE_STYLE.fontFamily`, so the picker reflects what the
 * user sees on the page.
 *
 * Subscribes to `onCursorMove` so the picker re-renders as the caret
 * moves between runs with different families. Accepts any editor shape
 * exposing the two methods structurally (docs `EditorAPI`, slides
 * `SlidesTextBoxEditor`); callers do not import a concrete editor type.
 */

import { useEffect, useState } from "react";
import { DEFAULT_INLINE_STYLE } from "@wafflebase/docs";

export interface FontFamilySource {
  getRangeStyleSummary(): { fontFamily?: string | "mixed" };
  onCursorMove(cb: () => void): () => void;
}

export function useResolvedFontFamily(
  editor: FontFamilySource | null,
): string | undefined {
  const [summary, setSummary] = useState<{ fontFamily?: string | "mixed" }>(
    () => (editor ? editor.getRangeStyleSummary() : {}),
  );
  useEffect(() => {
    if (!editor) {
      // Reset so the picker reverts to the default/unset family instead
      // of showing the previous editor's stale value.
      setSummary({});
      return;
    }
    const refresh = (): void => setSummary(editor.getRangeStyleSummary());
    refresh();
    return editor.onCursorMove(refresh);
  }, [editor]);
  if (summary.fontFamily === "mixed") return undefined;
  return summary.fontFamily ?? DEFAULT_INLINE_STYLE.fontFamily;
}
