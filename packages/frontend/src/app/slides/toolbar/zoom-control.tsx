import { useEffect, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { ZoomController } from "../zoom-controller";
import { FIT_ZOOM, ZOOM_PRESETS } from "../zoom-controller";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export interface ZoomControlProps {
  controller: ZoomController | null | undefined;
}

/**
 * Zoom dropdown shown in the slides toolbar's left zone.
 *
 * Mirrors Google Slides:
 *   ┌──────────┐
 *   │ Fit      │ ← always at the top — viewport-relative scale
 *   ├──────────┤
 *   │ 50%      │
 *   │ 75%      │ ← absolute presets — slide size × N %
 *   │ 100%     │
 *   │ 150%     │
 *   │ 200%     │
 *   └──────────┘
 *
 * Picking Fit triggers `refitCanvas` with the column-fit path;
 * picking N% switches to the absolute-zoom path with scroll bars.
 */
export function ZoomControl({ controller }: ZoomControlProps) {
  const [value, setValue] = useState<number>(
    controller?.get() ?? FIT_ZOOM,
  );

  useEffect(() => {
    if (!controller) return;
    setValue(controller.get());
    return controller.subscribe(() => setValue(controller.get()));
  }, [controller]);

  const label = value === FIT_ZOOM ? "Fit" : `${Math.round(value * 100)}%`;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Zoom"
              disabled={!controller}
              className="inline-flex cursor-pointer h-7 min-w-[64px] items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span>{label}</span>
              <IconChevronDown size={12} className="ml-1 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Zoom</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuCheckboxItem
          checked={value === FIT_ZOOM}
          onClick={() => controller?.set(FIT_ZOOM)}
        >
          Fit
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuCheckboxItem
            key={preset}
            checked={value === preset}
            onClick={() => controller?.set(preset)}
          >
            {`${Math.round(preset * 100)}%`}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
