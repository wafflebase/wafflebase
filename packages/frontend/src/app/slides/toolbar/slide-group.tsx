import { useCallback, useEffect, useRef } from "react";
import { IconPlus, IconChevronDown } from "@tabler/icons-react";
import { showLayoutPicker } from "@wafflebase/slides";
import type { SlidesStore } from "@wafflebase/slides";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export interface SlideGroupProps {
  store: SlidesStore | null;
}

/**
 * "+ Slide ▾" split-button lifted from the old SlidesFormattingToolbar.
 * Primary button adds a blank slide; the chevron opens the layout picker.
 */
export function SlideGroup({ store }: SlideGroupProps) {
  const layoutChevronRef = useRef<HTMLButtonElement | null>(null);
  const pickerCloseRef = useRef<(() => void) | null>(null);

  const onAddBlankSlide = useCallback(() => {
    if (!store) return;
    store.batch(() => store.addSlide("blank"));
  }, [store]);

  const onOpenLayoutPicker = useCallback(() => {
    if (!store) return;
    if (pickerCloseRef.current) {
      pickerCloseRef.current();
      return;
    }
    const el = layoutChevronRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pickerCloseRef.current = showLayoutPicker(document.body, {
      store,
      trigger: el,
      anchor: { x: rect.left, y: rect.bottom + 4 },
      onPick: (layoutId) => {
        store.batch(() => store.addSlide(layoutId));
      },
      onClose: () => {
        pickerCloseRef.current = null;
      },
    });
  }, [store]);

  // Close the popover if the component unmounts mid-pick.
  useEffect(() => () => pickerCloseRef.current?.(), []);

  return (
    <div className="inline-flex items-center rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onAddBlankSlide}
            disabled={!store}
            aria-label="Add slide"
            className="inline-flex h-7 items-center gap-1 rounded-l-md px-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconPlus size={16} />
            <span className="text-xs">Slide</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Add slide</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={layoutChevronRef}
            type="button"
            onClick={onOpenLayoutPicker}
            disabled={!store}
            aria-label="Choose a layout"
            className="inline-flex h-7 w-6 items-center justify-center rounded-r-md border-l hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconChevronDown size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Choose a layout</TooltipContent>
      </Tooltip>
    </div>
  );
}
