import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { toggleVariants } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The dock's split tools (`[Sticky][▾]`, `[Marker][▾]`, `[Stamp][▾]`):
 * the main half places or arms the tool, the chevron opens its options.
 * They used to be built three ways — a 20px dimmed chevron, a ~36px one
 * (Button's `has-[>svg]:px-2.5` beat the call site's `px-0.5`) and a
 * full-opacity one with no tooltip — so the pieces live here.
 *
 * ```tsx
 * <SplitTool>
 *   <Tooltip>…<Toggle aria-label="Marker" …/>…</Tooltip>
 *   <Popover>
 *     <SplitToolChevron menu="popover" label="Pen, colour and width" />
 *     <PopoverContent>…</PopoverContent>
 *   </Popover>
 * </SplitTool>
 * ```
 */
export function SplitTool({ children }: { children: ReactNode }) {
  return <div className="flex items-center">{children}</div>;
}

/**
 * The chevron half: 20px wide, a dimmed 12px caret and a tooltip naming
 * what it opens. A plain `<button>` rather than `Button`, whose `sm` size
 * adds `has-[>svg]:px-2.5` and so widens it whatever the call site says.
 *
 * Coarse pointers take the same floors a `Toggle` does: 44px tall, and at
 * least the 32px a `sm` Toggle keeps when it is rendered outside a
 * `Toolbar` (the More popover); inside the dock the strip's own
 * `pointer-coarse:min-w-11` rule widens it to 44 like its neighbours.
 *
 * Must sit inside the `DropdownMenu` or `Popover` named by `menu`.
 */
export function SplitToolChevron({
  label,
  tooltip = label,
  menu = "dropdown",
  disabled,
}: {
  /** The trigger's accessible name, e.g. "Sticky note color". */
  label: string;
  /** Omitted: the label. */
  tooltip?: ReactNode;
  /** Which Radix menu the chevron opens. */
  menu?: "dropdown" | "popover";
  disabled?: boolean;
}) {
  const Trigger = menu === "popover" ? PopoverTrigger : DropdownMenuTrigger;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Trigger asChild>
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            data-split-chevron=""
            className={cn(
              "inline-flex h-8 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none",
              "hover:bg-muted hover:text-muted-foreground aria-expanded:bg-muted",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
              "pointer-coarse:min-h-11 pointer-coarse:min-w-8",
            )}
          >
            <IconChevronDown aria-hidden="true" className="size-3 opacity-50" />
          </button>
        </Trigger>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A one-shot command (drop a sticky, pick an image) that sits among the
 * dock's tool toggles. It looks like an unpressed `Toggle` but carries no
 * `aria-pressed`: a Toggle hard-wired off made a screen reader announce
 * "not pressed" on something that has no pressed state.
 */
export const ToolCommandButton = forwardRef<HTMLButtonElement, ComponentProps<"button">>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(toggleVariants({ size: "sm" }), className)}
      {...props}
    />
  ),
);
ToolCommandButton.displayName = "ToolCommandButton";

/**
 * Marks a control that opens a menu with a small triangle in its
 * bottom-right corner (FigJam, Figma), so Shape and Line read as pickers
 * rather than as one-shot tools. A wrapper rather than a class on the
 * trigger, because the triggers are the Slides pickers' own buttons.
 *
 * The triangle sits outside the button, so it neither changes the
 * button's box nor joins its accessible name; it follows the button's
 * coarse-pointer growth because it is pinned to the wrapper's corner.
 */
export function MenuCaret({ children }: { children: ReactNode }) {
  return (
    <span className="group/caret relative inline-flex shrink-0">
      {children}
      <svg
        aria-hidden="true"
        data-menu-caret=""
        viewBox="0 0 4 4"
        className="pointer-events-none absolute right-[3px] bottom-[3px] size-[5px] opacity-50 group-has-[:disabled]/caret:opacity-25"
      >
        <path d="M4 0V4H0Z" fill="currentColor" />
      </svg>
    </span>
  );
}
