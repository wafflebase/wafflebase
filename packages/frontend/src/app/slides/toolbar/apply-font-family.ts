import type { SlidesEditor } from "@wafflebase/slides";
import { ensureFontLink } from "@/components/text-formatting";

/** Minimal text-box surface the family apply needs — both the desktop
 *  and mobile slides toolbars pass `state.textEditor`, which satisfies
 *  this structurally. */
interface FamilyTextEditor {
  applyStyle(style: { fontFamily: string }): void;
  focus(): void;
}

/**
 * Apply a font family to the active slide text box, shared by the
 * desktop text-edit section and the mobile format sheet.
 *
 * Lazy-loads the family's Google Fonts `<link>` first (no-op for
 * eager/system families), applies the style, then repaints once the
 * possibly-async web face resolves. The slides renderer is dirty-gated,
 * so without the explicit `markDirty` the canvas would keep painting the
 * fallback until the next unrelated edit — the same reason image-cache
 * loads call back into a repaint.
 */
export function applySlideFontFamily(
  textEditor: FamilyTextEditor,
  family: string,
  editor: SlidesEditor | null,
): void {
  ensureFontLink(family);
  textEditor.applyStyle({ fontFamily: family });
  textEditor.focus();
  if (typeof document !== "undefined" && editor) {
    document.fonts
      .load(`16px ${JSON.stringify(family)}`)
      .then(() => {
        editor.markDirty();
        editor.render();
      })
      .catch(() => {});
  }
}
