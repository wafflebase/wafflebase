import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The positioned box a revision preview covers.
 *
 * `RevisionPreview` renders `absolute inset-0`, so what it actually hides is
 * decided entirely by which ancestor is `position: relative`. Mounting it
 * beside the canvas alone — which is where every editor put it originally —
 * left the surrounding chrome live and clickable underneath a banner that
 * says "Viewing a version": the slides toolbar's "Delete slide", the notes
 * toolbar, the sheet tab bar's delete-tab menu. Every one of those mutates
 * the **live** document, with no visible feedback because the canvas that
 * would have shown the change is behind the preview. An earlier round closed
 * the same hole for the keyboard (see `RevisionPreview`'s capture-phase
 * suppressor); this closes it for the pointer.
 *
 * So the rule this component exists to enforce is: everything a preview must
 * replace goes in `children`, and the preview goes in `preview`. Google Docs
 * does the same — opening a version replaces the whole editing surface, not
 * just the page.
 *
 * Deliberately *not* wrapped around the version-history panel: the panel is
 * how a user reaches the next version, so covering it would leave a preview
 * with no way out but "Back to current version". Editors therefore keep the
 * panel as a sibling of this surface, not a child.
 */
export function PreviewSurface({
  className,
  preview,
  children,
}: {
  /** Extra classes for the surface box; merged after the base ones. */
  className?: string;
  /**
   * The overlay. Rendered last so it paints above `children` without any
   * of them needing a `z-index` of their own.
   */
  preview?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative flex flex-1 flex-col min-w-0", className)}>
      {children}
      {preview}
    </div>
  );
}

export default PreviewSurface;
