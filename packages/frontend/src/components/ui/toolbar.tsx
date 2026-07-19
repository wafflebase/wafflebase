import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Root container for a horizontal toolbar strip.
 * Provides consistent height, spacing, scroll and border styling
 * shared across the Sheets and Docs formatting toolbars.
 */
function Toolbar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap",
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
