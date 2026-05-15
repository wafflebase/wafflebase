import { useEffect, useRef, useState } from "react";
import { IconShape } from "@tabler/icons-react";
import { renderShapeIcon } from "@wafflebase/slides";
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
import {
  SHAPE_PICKER_CATEGORIES,
  type PickerInsertKind,
} from "./shape-picker-helpers";

interface IconButtonProps {
  kind: PickerInsertKind;
  label: string;
  active: boolean;
  onSelect: (kind: PickerInsertKind) => void;
}

/** Connector insert-mode keys aren't in `PATH_BUILDERS` — render their
 * preview inline as a thin line (with an arrowhead for `:arrow`). */
function isConnectorPickerKind(
  kind: PickerInsertKind,
): kind is "connector:line" | "connector:arrow" {
  return kind === "connector:line" || kind === "connector:arrow";
}

function drawConnectorIcon(
  ctx: CanvasRenderingContext2D,
  kind: "connector:line" | "connector:arrow",
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
    ctx.stroke();
  }
}

/**
 * One canvas-rendered shape preview button. The 24×24 canvas is
 * painted from the same `PATH_BUILDERS` registry the slide canvas
 * uses (via `renderShapeIcon`) for ShapeKinds, so the picker
 * preview can never drift from the geometry the user gets after
 * dragging on the slide. For connector kinds (line / arrow) — which
 * live outside the shape registry — the preview is drawn inline
 * by `drawConnectorIcon`.
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
    if (isConnectorPickerKind(kind)) {
      drawConnectorIcon(ctx, kind, { w: 24, h: 24 });
    } else {
      renderShapeIcon(kind, ctx, { w: 24, h: 24 });
    }
  }, [kind]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      onClick={() => onSelect(kind)}
      className="flex size-8 items-center justify-center rounded text-foreground hover:bg-accent data-[active=true]:bg-accent"
    >
      <canvas ref={ref} className="size-6" />
    </button>
  );
}

export interface ShapePickerProps {
  /** Currently-active picker insert kind (shape or connector), or
   * `null` when no shape insert is armed (e.g. user is in text-box
   * insert mode or no insert mode at all). Used to highlight the
   * matching button. */
  activeKind: PickerInsertKind | null;
  /** Called when the user picks an entry. Caller is responsible for
   * arming insert mode (`editor.setInsertMode(kind)`). */
  onSelect: (kind: PickerInsertKind) => void;
  /** Disables the trigger button when the editor isn't ready yet. */
  disabled?: boolean;
}

/**
 * "Shape ▾" toolbar control. Single trigger button opens a popover
 * with five labelled categories — Lines, Shapes, Block Arrows,
 * Callouts, Equation — laid out as 6-column grids of canvas
 * previews. Replaces the previous five inline insert buttons in
 * `slides-formatting-toolbar.tsx`.
 */
export function ShapePicker({
  activeKind,
  onSelect,
  disabled,
}: ShapePickerProps) {
  // Controlled open state so we can close the picker as soon as the
  // user picks a shape. The grid buttons are plain <button>s (not
  // `DropdownMenuItem`), so Radix doesn't auto-close on click —
  // without this the menu stays open after `onSelect`, requiring a
  // second click off-menu to dismiss it.
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Shape"
              // data-state mirrors the Toggle component so the pressed
              // visual (bg-accent / text-accent-foreground) matches the
              // Select / Text Toggles next to it.
              data-state={activeKind !== null ? "on" : "off"}
              disabled={disabled}
              className="inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-1.5 text-sm hover:bg-muted hover:text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <IconShape size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Shape</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="z-50 max-h-[480px] w-[280px] overflow-y-auto p-2"
      >
        {SHAPE_PICKER_CATEGORIES.map((cat) => (
          <section key={cat.id} className="mb-2 last:mb-0">
            <h4 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {cat.title}
            </h4>
            <div className="grid grid-cols-6 gap-1">
              {cat.kinds.map((entry) => (
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
          </section>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
