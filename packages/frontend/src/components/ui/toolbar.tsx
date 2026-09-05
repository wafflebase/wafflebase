import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Root container for a horizontal toolbar strip.
 * Provides consistent height, spacing, scroll and border styling
 * shared across the Sheets and Docs formatting toolbars.
 *
 * On a coarse pointer every `button` inside takes a 44px height floor.
 * The toolbars are built from 28–32px buttons — correct for a cursor,
 * and roughly half of what a fingertip can hit reliably, which on a
 * strip of adjacent single-purpose buttons means the neighbour is as
 * likely as the target. Applied here, on the shared root, so Sheets,
 * Docs, Slides and Board are covered at once.
 *
 * Width is the harder half, and it is what `touchTargets` selects
 * between. Both modes were measured under real coarse emulation.
 *
 * `"scroll"` (default) is for the strips that already overflow and
 * scroll. They get a width floor too, plus `shrink-0` — which is not
 * decoration. A flex item's default `min-width: auto` resolves to its
 * min-content size, and *that* is what made these strips overflow
 * rather than compress. Replacing it with a hard 44px hands every
 * button its content width as shrink budget; the measured result was
 * a font picker at 64.9px with a truncated label and a Docs "Page
 * number" label spilling out over its neighbour.
 *
 * The width floor also skips any button that declares a `min-w-` of its
 * own. A descendant selector outranks the `min-w-[112px]` that
 * `FontFamilyPicker`, `TextStyleGroup` and `ZoomControl` each set, and
 * silently replacing a stability floor with a smaller one made those
 * triggers resize as their label changed — the zoom trigger shifting
 * everything to its right on every zoom change.
 *
 * `"fit"` is for a strip that must fit its viewport rather than scroll:
 * the mobile slides bars pin Done / ⋮ to the right with a `flex-1`
 * spacer, and a spacer collapses to zero the moment the row overflows.
 * With the width floor on, that row measured 428px against a 390px
 * iPhone and pushed Done 30px off-screen. So `"fit"` takes the height
 * floor only, leaving icon buttons 28px wide and 44px tall. That is a
 * real compromise, and the better half of one: a fingertip on a
 * horizontal strip is bounded by height far more often than by width.
 *
 * Controls rendered into a portal — everything inside a dropdown, a
 * popover or a bottom sheet — are outside this subtree and keep their
 * own sizing. That is a real remaining gap on the mobile slides
 * surface, where most controls live in sheets; see
 * docs/design/slides/slides-mobile.md.
 */
function Toolbar({
  className,
  children,
  touchTargets = "scroll",
  ...props
}: React.ComponentProps<"div"> & {
  touchTargets?: "scroll" | "fit";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap",
        "pointer-coarse:gap-1 pointer-coarse:py-1.5",
        "pointer-coarse:[&_button]:min-h-11",
        touchTargets === "scroll" && [
          "pointer-coarse:[&_button:not([class*='min-w-'])]:min-w-11",
          "pointer-coarse:[&_button]:shrink-0",
        ],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Vertical separator between toolbar button groups.
 * Standardises the gap and height so Sheets and Docs toolbars
 * look identical when switching between editors.
 */
function ToolbarSeparator({
  className,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  orientation,
  ...props
}: React.ComponentProps<typeof Separator>) {
  // bg-border (--border at oklch 0.92) is too faint to read as a divider
  // against the toolbar background. Bump the contrast so the vertical line
  // is actually visible between button groups.
  return (
    <Separator
      {...props}
      orientation="vertical"
      className={cn("mx-2 !h-5 bg-zinc-300 dark:bg-zinc-700", className)}
    />
  );
}

/**
 * Canonical toolbar trigger button, shared across every editor toolbar
 * (Sheets / Docs / Slides / Notes) so triggers stop re-inlining the same
 * class string.
 *
 * - `variant="icon"` (default): a 28×28 icon-only button.
 * - `variant="menu"`: a labelled / chevron trigger (icon + caret, or a
 *   short text label) with horizontal padding.
 *
 * Forwards its ref so it can slot directly into Radix `asChild` triggers
 * (`DropdownMenuTrigger` / `TooltipTrigger`), and spreads all button
 * props (`disabled`, `aria-label`, `onMouseDown`, `data-*`, …).
 *
 * Pressed/toggle buttons (Bold / Italic / …) use the `Toggle` primitive,
 * not this component — so there is deliberately no `active` variant here.
 */
const toolbarButtonVariants = cva(
  // Disabled uses `pointer-events-none` (the shadcn Button/Toggle convention)
  // so a disabled button neither highlights on hover nor shows the not-allowed
  // cursor — matching the Slides toolbar buttons that were already on it.
  "inline-flex h-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        icon: "w-7",
        menu: "gap-0.5 px-1.5",
      },
    },
    defaultVariants: {
      variant: "icon",
    },
  },
);

const ToolbarButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & VariantProps<typeof toolbarButtonVariants>
>(({ className, type = "button", variant, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(toolbarButtonVariants({ variant }), className)}
      {...props}
    />
  );
});
ToolbarButton.displayName = "ToolbarButton";

export { Toolbar, ToolbarSeparator, ToolbarButton };
