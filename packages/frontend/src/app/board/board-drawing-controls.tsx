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
 * The marker popover's extra rows: the laser pointer and the smart-shapes
 * switch. Smart shapes is remembered with the pen choice (`board-ink.ts`).
 */
export function BoardInkExtras({
  laser,
  ink,
  smartShapes,
}: {
  laser: ToggleTool | null;
  ink: InkTool | null;
  smartShapes: boolean;
}) {
  const laserOn = useToggleOn(laser);
  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <Button
        size="sm"
        variant={laserOn ? "secondary" : "ghost"}
        aria-pressed={laserOn}
        className="h-8 justify-start gap-2 px-2"
        disabled={!laser}
        onClick={() => laser?.set(!laserOn)}
      >
        <IconPointerBolt size={14} />
        Laser pointer
        <span className="text-muted-foreground ml-auto text-xs">{DRAWING_HINTS.laser}</span>
      </Button>
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
