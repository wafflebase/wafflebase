import { useEffect, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { ZoomController } from "../zoom-controller";
import { ZOOM_PRESETS } from "../zoom-controller";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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
 * Zoom dropdown shown in the slides toolbar's right-global zone.
 * Reads + writes through the `ZoomController` shared with `SlidesView`,
 * so picking a preset triggers `refitCanvas` automatically. The
 * "Fit" label corresponds to a zoom of 1.0 — the editor's legacy
 * column-fit behavior.
 */
export function ZoomControl({ controller }: ZoomControlProps) {
  const [value, setValue] = useState<number>(controller?.get() ?? 1.0);

  useEffect(() => {
    if (!controller) return;
    setValue(controller.get());
    return controller.subscribe(() => setValue(controller.get()));
  }, [controller]);

  const label = value === 1.0 ? "Fit" : `${Math.round(value * 100)}%`;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Zoom"
              disabled={!controller}
              className="inline-flex h-7 min-w-[64px] items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span>{label}</span>
              <IconChevronDown size={12} className="ml-1 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Zoom</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => controller?.set(preset)}
          >
            {preset === 1.0 ? "Fit" : `${Math.round(preset * 100)}%`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
