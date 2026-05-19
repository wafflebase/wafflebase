import { useEffect, useRef, useState } from "react";
import { IconLine } from "@tabler/icons-react";
import { type ConnectorInsertKind } from "@wafflebase/slides";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { LINE_PICKER_ENTRIES } from "./line-picker-helpers";

/**
 * Paint a tiny connector preview onto a 24×24 canvas: a thin diagonal
 * stroke for `'connector:line'`, plus a filled arrowhead at the far
 * endpoint for `'connector:arrow'`. Mirrors the geometry the editor
 * eventually commits to the slide so the picker preview matches the
 * dropped element.
 */
function drawConnectorIcon(
  ctx: CanvasRenderingContext2D,
  kind: ConnectorInsertKind,
  size: { w: number; h: number },
): void {
  const padding = 3;
  const x0 = padding;
  const y0 = size.h - padding;
  const x1 = size.w - padding;
  const y1 = padding;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  if (kind === "connector:arrow") {
    // Tiny arrowhead at the (x1, y1) end. Direction vector is normalised
    // along the diagonal so the head sits flush on the line endpoint.
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular for the wing offset.
    const px = -uy;
    const py = ux;
    const headLen = 6;
    const headHalf = 3;
    const baseX = x1 - ux * headLen;
    const baseY = y1 - uy * headLen;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(baseX + px * headHalf, baseY + py * headHalf);
    ctx.lineTo(baseX - px * headHalf, baseY - py * headHalf);
    ctx.closePath();
    // Fill the arrowhead so the picker preview matches the runtime
    // arrowhead-renderer (filled triangle), not a thin outlined wedge.
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
}

interface IconButtonProps {
  kind: ConnectorInsertKind;
  label: string;
  active: boolean;
  onSelect: (kind: ConnectorInsertKind) => void;
}

/**
 * One canvas-rendered connector preview button. The 24×24 canvas is
 * painted inline by `drawConnectorIcon` — connectors don't live in
 * the shape `PATH_BUILDERS` registry, so they have their own preview
 * path.
 */
function IconButton({ kind, label, active, onSelect }: IconButtonProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = 24 * dpr;
    canvas.height = 24 * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, 24, 24);
    // Canvas 2D doesn't understand the CSS "currentColor" keyword and
    // silently falls back to black — invisible against the dark popover
    // surface. Resolve the cascaded color from the canvas element so
    // the stroke follows `text-foreground` for both light and dark modes.
    ctx.strokeStyle = window.getComputedStyle(canvas).color || "#000";
    drawConnectorIcon(ctx, kind, { w: 24, h: 24 });
  }, [kind]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      onClick={() => onSelect(kind)}
      className="flex h-8 items-center gap-2 rounded px-2 text-foreground hover:bg-accent data-[active=true]:bg-accent"
    >
      <canvas ref={ref} className="size-6 shrink-0" />
      <span className="text-sm">{label}</span>
    </button>
  );
}

export interface LinePickerProps {
  /** Currently-active connector insert kind, or `null` when no line
   * insert is armed. Used to highlight the matching entry and to
   * toggle the trigger's pressed visual. */
  activeKind: ConnectorInsertKind | null;
  /** Called when the user picks an entry. Caller is responsible for
   * arming insert mode (`editor.setInsertMode(kind)`). */
  onSelect: (kind: ConnectorInsertKind) => void;
  /** Disables the trigger button when the editor isn't ready yet. */
  disabled?: boolean;
  /** Override the default toolbar trigger button — used by the mobile
   * Insert sheet to match the surrounding `SheetActionButton` row. */
  trigger?: React.ReactNode;
}

/**
 * "Line ▾" toolbar control. Sits immediately to the right of the
 * `<ShapePicker />` Shape button. Single trigger opens a small
 * dropdown with two entries (Line + Arrow) — connectors are split out
 * of the shape picker because their insertion UX is endpoint-anchored
 * (snap-to-shape, click-to-anchor endpoints) rather than the
 * rectangular drag-to-size shapes use. Matches Google Slides' top
 * toolbar layout where Line is a separate tool from Shape.
 */
export function LinePicker({
  activeKind,
  onSelect,
  disabled,
  trigger,
}: LinePickerProps) {
  // Controlled open state so we can close the dropdown as soon as the
  // user picks an entry. Mirrors the pattern in `<ShapePicker />`.
  const [open, setOpen] = useState(false);
  const defaultTrigger = (
    <button
      type="button"
      aria-label="Line"
      // data-state mirrors the Toggle component so the pressed
      // visual matches the sibling Shape / Text / Select toggles.
      data-state={activeKind !== null ? "on" : "off"}
      disabled={disabled}
      className="inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-1.5 text-sm hover:bg-muted hover:text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <IconLine size={16} />
    </button>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{defaultTrigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Line</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="z-50 w-[160px] p-1"
      >
        <div className="flex flex-col gap-0.5">
          {LINE_PICKER_ENTRIES.map((entry) => (
            <IconButton
              key={entry.kind}
              kind={entry.kind}
              label={entry.label}
              active={entry.kind === activeKind}
              onSelect={(k) => {
                onSelect(k);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
