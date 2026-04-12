import * as React from "react";
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
  return (
    <Separator
      {...props}
      orientation="vertical"
      className={cn("mx-2 h-5", className)}
    />
  );
}

/**
 * Toolbar icon button — the most common pattern in both toolbars.
 * A plain 28×28 clickable icon area with hover highlight.
 */
function ToolbarButton({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Toolbar, ToolbarSeparator, ToolbarButton };
