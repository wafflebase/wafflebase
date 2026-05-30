import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface ColorSwatchButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Top-half icon node, sized to ~14 px so the stripe slot stays visible. */
  icon: ReactNode;
  /**
   * CSS color string drawn as a 3 px stripe at the bottom of the button.
   * `undefined` renders a faint outlined slot — the slot is always
   * present so the button reads as "this is a color control".
   */
  color?: string;
  /** Accessible label (also fed to the parent tooltip via `aria-label`). */
  label: string;
}

/**
 * Square button with a top-aligned icon and a bottom color stripe that
 * shows the control's current value. Used by every "set a color"
 * control in the slides toolbar (Slide background, Shape fill, Text
 * box background, Border color) so the affordance reads consistently
 * — the stripe is the signal that the button opens a color picker,
 * matching the Google Slides convention.
 *
 * `forwardRef` + prop spreading let this slot in as a child of
 * `<DropdownMenuTrigger asChild>` / `<TooltipTrigger asChild>` without
 * losing Radix's event handlers or aria attributes.
 */
export const ColorSwatchButton = forwardRef<
  HTMLButtonElement,
  ColorSwatchButtonProps
>(({ icon, color, label, className, disabled, ...rest }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      disabled={disabled}
      className={[
        "inline-flex h-7 w-7 cursor-pointer flex-col items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span className="flex h-3.5 items-center justify-center">{icon}</span>
      <span
        className="mt-0.5 block h-[3px] w-4 rounded-sm border"
        style={{
          backgroundColor: color ?? "transparent",
          // When no colour is set, the slot still draws a 1 px outlined
          // strip so users see the affordance even before picking.
          borderColor: color ? color : "var(--border)",
        }}
      />
    </button>
  );
});
ColorSwatchButton.displayName = "ColorSwatchButton";
