import { Loader2 } from "lucide-react";

/**
 * Renders a loading indicator, centred in whatever box it is given.
 *
 * Render it bare — `if (loading) return <Loader />` — and do **not** wrap it
 * in a centring box. It sizes itself on both axes so that one primitive is
 * correct in all three kinds of parent:
 *
 * - `w-full` fills the cross axis of a **row**-flex parent, which is what
 *   every editor's canvas sits in (`PreviewSurface`). Without it the loader
 *   is shrink-to-fit, so `justify-content: flex-start` pins it to the left
 *   edge and its own `items-center` centres the spinner inside that collapsed
 *   box — measured at 63px wide inside a 1016px surface, which is how a
 *   loading note came to show its spinner hard against the left margin.
 * - `flex-1` fills the main axis of a **column**-flex parent, where the same
 *   collapse would otherwise leave a 300px box at the top of a full-height
 *   column.
 * - Both are inert in a block parent, where `min-h` carries the height.
 *
 * The contract is pinned by `__tests__/loader.test.tsx`, because jsdom has no
 * layout engine and nothing else would catch the class going missing.
 */
export const Loader = () => {
  return (
    <div
      className="flex flex-1 w-full flex-col items-center justify-center min-h-[300px]"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
    </div>
  );
};
