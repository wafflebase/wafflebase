/**
 * Shared font-size stepper: two buttons (A↓ / A↑) that bump the current
 * font size through a fixed list of stops. Mirrors the Google Slides /
 * PowerPoint A↑ / A↓ stepper next to the Size dropdown.
 *
 * Props are intentionally narrow (`currentSize` + `onPick`) — the
 * stepper is reused at two sites that have very different write paths:
 *   - slides text-edit state (writes through a docs `EditorAPI.applyStyle`)
 *   - slides text-element box state (writes through `withTextElement`
 *     over every inline run in the box)
 * Wrapping both behind a TextFormattingEditor would force one of the
 * call sites to fake a half-dozen no-op methods. The thin prop pair is
 * cleaner.
 */

import { IconTextIncrease, IconTextDecrease } from "@tabler/icons-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { bumpSize } from "./text-size-stepper-helpers";

interface TextSizeStepperProps {
  /** Current selection / box font size; `undefined` is treated as 11. */
  currentSize: number | undefined;
  /** Called with the bumped size; caller writes to its own editor / store. */
  onPick: (next: number) => void;
  disabled?: boolean;
}

const buttonClass =
  "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

export function TextSizeStepper({
  currentSize,
  onPick,
  disabled = false,
}: TextSizeStepperProps) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // mousedown-preventDefault keeps focus inside the active text
            // box so the bump applies to the user's live selection
            // instead of a freshly-collapsed cursor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(bumpSize(currentSize, -1))}
            disabled={disabled}
            aria-label="Decrease font size"
            className={buttonClass}
            data-text-edit-keepalive
          >
            <IconTextDecrease size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Decrease font size</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(bumpSize(currentSize, +1))}
            disabled={disabled}
            aria-label="Increase font size"
            className={buttonClass}
            data-text-edit-keepalive
          >
            <IconTextIncrease size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Increase font size</TooltipContent>
      </Tooltip>
    </>
  );
}
