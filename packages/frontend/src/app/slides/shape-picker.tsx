import { useEffect, useRef } from "react";
import { IconShape } from "@tabler/icons-react";
import { renderShapeIcon, type ShapeKind } from "@wafflebase/slides";
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
import { SHAPE_PICKER_CATEGORIES } from "./shape-picker-helpers";

interface IconButtonProps {
  kind: ShapeKind;
  label: string;
  active: boolean;
  onSelect: (kind: ShapeKind) => void;
}

/**
 * One canvas-rendered shape preview button. The 24×24 canvas is
 * painted from the same `PATH_BUILDERS` registry the slide canvas
 * uses (via `renderShapeIcon`), so the picker preview can never
 * drift from the geometry the user gets after dragging on the
 * slide.
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
    renderShapeIcon(kind, ctx, { w: 24, h: 24 });
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
  /** Currently-active insert shape kind, or `null` when no shape
   * insert is armed (e.g. user is in text-box insert mode or no
   * insert mode at all). Used to highlight the matching button. */
  activeKind: ShapeKind | null;
  /** Called when the user picks a shape. Caller is responsible for
   * arming insert mode (`editor.setInsertMode(kind)`). */
  onSelect: (kind: ShapeKind) => void;
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
  return (
    <DropdownMenu>
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
                  onSelect={(k) => onSelect(k)}
                />
              ))}
            </div>
          </section>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
