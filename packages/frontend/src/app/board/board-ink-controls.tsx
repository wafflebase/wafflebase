import { useEffect, useState } from "react";
import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import {
  IconEraser,
  IconHighlight,
  IconPencil,
} from "@tabler/icons-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  INK_COLORS,
  INK_HINTS,
  INK_WIDTHS,
  armInkPen,
  type InkPen,
  type InkTool,
  type InkWidth,
} from "./board-ink";
import { BoardInkExtras } from "./board-drawing-controls";
import { SplitToolChevron } from "./board-split-tool-button";

const PEN_LABEL: Record<InkPen, string> = {
  marker: "Marker",
  highlighter: "Highlighter",
};

const WIDTH_LABEL: Record<InkWidth, string> = {
  thin: "Thin",
  medium: "Medium",
  thick: "Thick",
};

export interface BoardInkControlsProps {
  editor: SlidesEditor | null;
  ink: InkTool | null;
  insertMode: InsertKind | null;
  disabled?: boolean;
  /**
   * Whether the Eraser toggle follows the pen. Omitted: it does. The
   * dock's compact (phone) layout sets it false and offers
   * `BoardEraserToggle` under "More" instead.
   */
  withEraser?: boolean;
}

/**
 * The toolbar's ink block: `[Marker][▾] [Eraser]`.
 *
 * The pen toggle arms whichever pen was last chosen (marker or
 * highlighter); the chevron opens the pen, colour and width choice,
 * made BEFORE drawing (FigJam) rather than by restyling a stroke after
 * it exists. Choosing anything in the popover also arms that pen.
 */
export function BoardInkControls({
  editor,
  ink,
  insertMode,
  disabled,
  withEraser = true,
}: BoardInkControlsProps) {
  const [state, setState] = useState(() => ink?.get() ?? null);
  useEffect(() => {
    if (!ink) return;
    setState(ink.get());
    return ink.subscribe(() => setState(ink.get()));
  }, [ink]);

  const off = disabled || !editor || !ink || !state;
  const pen = state?.pen ?? "marker";
  const style = state?.[pen];
  const drawing = insertMode === "freeform";
  const arm = (next: InkPen) => {
    if (editor && ink) armInkPen(editor, ink, next);
  };
  const PenIcon = pen === "highlighter" ? IconHighlight : IconPencil;

  return (
    <>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={drawing}
              onPressedChange={(pressed) =>
                pressed ? arm(pen) : editor?.setInsertMode(null)
              }
              aria-label={PEN_LABEL[pen]}
              disabled={off}
            >
              <PenIcon size={16} style={{ color: drawing ? style?.color : undefined }} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            {PEN_LABEL[pen]} ({INK_HINTS[pen]})
          </TooltipContent>
        </Tooltip>
        <Popover>
          <SplitToolChevron menu="popover" label="Pen, colour and width" disabled={off} />
          <PopoverContent align="start" className="w-auto p-2">
            {state && style && (
              <div className="flex flex-col gap-2">
                <div role="group" aria-label="Pen" className="flex gap-1">
                  {(["marker", "highlighter"] as const).map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={pen === p ? "secondary" : "ghost"}
                      aria-pressed={pen === p}
                      className="h-8 flex-1 gap-1 px-2"
                      onClick={() => arm(p)}
                    >
                      {p === "marker" ? <IconPencil size={14} /> : <IconHighlight size={14} />}
                      {PEN_LABEL[p]}
                      <span className="text-muted-foreground text-xs">{INK_HINTS[p]}</span>
                    </Button>
                  ))}
                </div>
                <div role="group" aria-label="Colour" className="grid grid-cols-8 gap-0.5">
                  {INK_COLORS.map((c) => {
                    const pressed = style.color.toUpperCase() === c.value.toUpperCase();
                    return (
                      <button
                        key={c.value}
                        type="button"
                        aria-label={c.name}
                        title={c.name}
                        aria-pressed={pressed}
                        onClick={() => {
                          ink?.setStyle(pen, { color: c.value });
                          arm(pen);
                        }}
                        className="focus-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted pointer-coarse:size-11"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-5 rounded-full border border-black/15",
                            pressed && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                          )}
                          style={{ backgroundColor: c.value }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div role="group" aria-label="Width" className="flex gap-1">
                  {(["thin", "medium", "thick"] as const).map((w) => (
                    <Button
                      key={w}
                      size="sm"
                      variant={style.width === w ? "secondary" : "ghost"}
                      aria-pressed={style.width === w}
                      aria-label={WIDTH_LABEL[w]}
                      title={WIDTH_LABEL[w]}
                      className="h-8 flex-1 px-2"
                      onClick={() => {
                        ink?.setStyle(pen, { width: w });
                        arm(pen);
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="block w-8 rounded-full bg-current"
                        // A preview of the weight, capped so a thick
                        // highlighter still fits the button.
                        style={{ height: Math.min(12, Math.max(2, INK_WIDTHS[pen][w] / 2.5)) }}
                      />
                    </Button>
                  ))}
                </div>
                <BoardInkExtras
                  ink={ink}
                  smartShapes={state.smartShapes === true}
                />
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {withEraser && (
        <BoardEraserToggle editor={editor} insertMode={insertMode} disabled={disabled} />
      )}
    </>
  );
}

/** The Eraser toggle (Shift+E): drag across strokes to remove them. */
export function BoardEraserToggle({
  editor,
  insertMode,
  disabled,
}: Pick<BoardInkControlsProps, "editor" | "insertMode" | "disabled">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={insertMode === "eraser"}
          onPressedChange={(pressed) =>
            editor?.setInsertMode(pressed ? "eraser" : null)
          }
          aria-label="Eraser"
          disabled={disabled || !editor}
        >
          <IconEraser size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Eraser ({INK_HINTS.eraser})</TooltipContent>
    </Tooltip>
  );
}
