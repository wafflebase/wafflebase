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
import { LINE_PICKER_ENTRIES, type LineToolKind } from "./line-picker-helpers";

/**
 * Paint a tiny connector preview onto a 24×24 canvas. The line shape
 * mirrors the routing the editor commits — diagonal for line/arrow,
 * L-shape for elbow, cubic bezier for curved — so the picker preview
 * matches the dropped element. Arrow / Elbow / Curved entries finish
 * with a filled arrowhead aligned to the path's local tangent.
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

  // Path shape per kind, plus the tangent at the end point used to
  // align the arrowhead (when one is drawn).
  let endTangent: { dx: number; dy: number };
  ctx.beginPath();
  if (kind === "connector:elbow") {
    // L-shape: down-right corner at (x1, y0).
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y1);
    endTangent = { dx: 0, dy: y1 - y0 };
  } else if (kind === "connector:curved") {
    // Cubic bezier whose tangents at the endpoints are horizontal-ish at
    // (x0, y0) and vertical-ish at (x1, y1), producing a visible curve.
    const c1x = x0 + (x1 - x0) * 0.6;
    const c1y = y0;
    const c2x = x1;
    const c2y = y0 + (y1 - y0) * 0.4;
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
    endTangent = { dx: x1 - c2x, dy: y1 - c2y };
  } else {
    // Straight diagonal (line + arrow share this geometry).
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    endTangent = { dx: x1 - x0, dy: y1 - y0 };
  }
  ctx.stroke();

  // Line has no arrowhead; arrow / elbow / curved all do.
  if (kind === "connector:line") return;

  const len = Math.max(1, Math.hypot(endTangent.dx, endTangent.dy));
  const ux = endTangent.dx / len;
  const uy = endTangent.dy / len;
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
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

/**
 * Paint a freehand-scribble preview — a small squiggle — onto a 24×24
 * canvas. Scribble isn't a connector, so it has its own icon path.
 */
function drawScribbleIcon(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
): void {
  const pad = 4;
  const x0 = pad;
  const x1 = size.w - pad;
  const midY = size.h / 2;
  const amp = (size.h - pad * 2) / 2.4;
  ctx.beginPath();
  ctx.moveTo(x0, midY + amp);
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    // 1.5 periods of a sine wave reads clearly as a scribble at 24px.
    const y = midY - Math.sin(t * Math.PI * 3) * amp;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

interface IconButtonProps {
  kind: LineToolKind;
  label: string;
  active: boolean;
  onSelect: (kind: LineToolKind) => void;
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
    if (kind === "freeform") drawScribbleIcon(ctx, { w: 24, h: 24 });
    else drawConnectorIcon(ctx, kind, { w: 24, h: 24 });
  }, [kind]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      onClick={() => onSelect(kind)}
      className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-foreground hover:bg-accent data-[active=true]:bg-accent"
    >
      <canvas ref={ref} className="size-6 shrink-0" />
      <span className="text-sm whitespace-nowrap">{label}</span>
    </button>
  );
}

export interface LinePickerProps {
  /** Currently-active line-tool kind (connector or scribble), or `null`
   * when no line insert is armed. Used to highlight the matching entry
   * and to toggle the trigger's pressed visual. */
  activeKind: LineToolKind | null;
  /** Called when the user picks an entry. Caller is responsible for
   * arming insert mode (`editor.setInsertMode(kind)`). */
  onSelect: (kind: LineToolKind) => void;
  /** Disables the trigger button when the editor isn't ready yet. */
  disabled?: boolean;
  /** Override the default toolbar trigger button — used by the mobile
   * Insert sheet to match the surrounding `SheetActionButton` row.
   * Must be a single element compatible with Radix's `asChild` slot
   * (forwarded refs + event handlers); `ReactNode` would allow text
   * nodes or fragments that the slot can't bind to. */
  trigger?: React.ReactElement;
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
        className="z-50 w-[200px] p-1"
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
