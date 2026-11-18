import { IconLasso, IconPointerBolt, IconWand } from "@tabler/icons-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DRAWING_HINTS, type ToggleTool } from "./board-drawing-extras";
import { useToggleOn } from "./use-toggle-on";
import type { InkTool } from "./board-ink";

/** The lasso-select toggle, beside Select: an empty-canvas drag draws a loop. */
export function BoardLassoToggle({
  tool,
  disabled,
}: {
  tool: ToggleTool | null;
  disabled?: boolean;
}) {
  const on = useToggleOn(tool);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={on}
          onPressedChange={(pressed) => tool?.set(pressed)}
          aria-label="Lasso select"
          disabled={disabled || !tool}
        >
          <IconLasso size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Lasso select (or {DRAWING_HINTS.lasso})</TooltipContent>
    </Tooltip>
  );
}

/**
 * The laser pointer (Shift+K): a fading trail peers see, nothing saved.
 * A presenting tool rather than a drawing one, so it sits in the top
 * bar's Facilitate group (`board-facilitate-controls.tsx`).
 */
export function BoardLaserToggle({
  tool,
  disabled,
}: {
  tool: ToggleTool | null;
  disabled?: boolean;
}) {
  const on = useToggleOn(tool);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={on}
          onPressedChange={(pressed) => tool?.set(pressed)}
          aria-label="Laser pointer"
          disabled={disabled || !tool}
        >
          <IconPointerBolt size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Laser pointer ({DRAWING_HINTS.laser})</TooltipContent>
    </Tooltip>
  );
}

/**
 * The marker popover's extra row: the smart-shapes switch, remembered
 * with the pen choice (`board-ink.ts`).
 */
export function BoardInkExtras({
  ink,
  smartShapes,
}: {
  ink: InkTool | null;
  smartShapes: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <Button
        size="sm"
        variant={smartShapes ? "secondary" : "ghost"}
        role="switch"
        aria-checked={smartShapes}
        className="h-8 justify-start gap-2 px-2"
        disabled={!ink}
        title="Turn a drawn box, circle, line or arrow into a clean shape"
        onClick={() => ink?.setSmartShapes(!smartShapes)}
      >
        <IconWand size={14} />
        Smart shapes
        <span className="text-muted-foreground ml-auto text-xs">{smartShapes ? "On" : "Off"}</span>
      </Button>
    </div>
  );
}
