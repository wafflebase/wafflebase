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
 * Chrome that sits *inside* this box is contained by covering it. Chrome
 * that must stay outside — a full-width toolbar above the row that also
 * holds the right-slot panels — is contained by {@link EditingChrome}
 * instead. Between them the rule is: while a preview is open, no editing
 * control is both rendered and reachable.
 *
 * Deliberately *not* wrapped around the version-history panel: the panel is
 * how a user reaches the next version, so covering it would leave a preview
 * with no way out but "Back to current version". Editors therefore keep the
 * panel as a sibling of this surface, not a child.
 *
 * The base classes are the row-flex box the editors already had around their
 * canvas, so adopting this component changes no non-preview layout; a caller
 * whose box is a column (sheets, whose tab bar sits under the grid) passes
 * `flex-col`.
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
    <div className={cn("relative flex flex-1 min-w-0", className)}>
      {children}
      {preview}
    </div>
  );
}

/**
 * Editing chrome that a version preview replaces by **removal** rather than
 * by covering.
 *
 * Slides and notes put their toolbar full-width above the row that holds the
 * canvas *and* the right-slot panels. Pulling that toolbar into the covered
 * box would contain it, but it would also narrow it by the panel's width
 * (288px) whenever a panel is open — a layout regression for every user of
 * every side panel, version history or not, and a divergence from Google
 * Slides, where side panels start below a full-width toolbar. So the toolbar
 * stays where it was and is simply not rendered while a preview is open,
 * which is what Google Docs does too: opening a version replaces the editing
 * surface rather than dimming it.
 *
 * Not rendering is strictly stronger than disabling — there is no control to
 * click, focus, or reach with a screen reader — and it costs only the
 * toolbar's own transient state (an open dropdown), never the editor's: the
 * view inside {@link PreviewSurface} stays mounted and attached throughout.
 */
export function EditingChrome({
  previewing,
  children,
}: {
  /** True while a revision preview is open over this editor. */
  previewing: boolean;
  children: ReactNode;
}) {
  if (previewing) return null;
  return <>{children}</>;
}

export default PreviewSurface;
