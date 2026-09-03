import { Loader2 } from "lucide-react";

/**
 * Renders a loading indicator, centred in whatever box it is given.
 *
 * Render it bare — `if (loading) return <Loader />` — and do **not** wrap it
 * in a centring box. It sizes itself so that one primitive is correct in
 * every parent shape the app has:
 *
 * - `flex-1` (`flex: 1 1 0%`) is what does the work. It fills the **main**
 *   axis of a flex parent in either orientation: the width of the row-flex
 *   `PreviewSurface` every editor's canvas sits in, and the height of a
 *   column-flex page body. Without it the loader is shrink-to-fit on that
 *   axis — measured at 63px inside a 1016px surface, with
 *   `justify-content: flex-start` pinning it to the left edge and its own
 *   `items-center` centring the spinner inside that collapsed box, which is
 *   how a loading note came to show its spinner against the left margin.
 * - `w-full` is redundant in every parent that exists today: a column-flex
 *   parent already stretches it, and in a row-flex one `flex-basis: 0%`
 *   decides the width before `width` is consulted. It is kept so that a
 *   parent which opts out of the stretch — `flex-col items-center` — cannot
 *   silently reintroduce the same shrink-to-fit one axis over.
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
