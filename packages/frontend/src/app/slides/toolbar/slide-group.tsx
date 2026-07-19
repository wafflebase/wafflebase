import { useCallback, useEffect, useRef } from "react";
import { IconPlus, IconChevronDown } from "@tabler/icons-react";
import { showLayoutPicker } from "@wafflebase/slides";
import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export interface SlideGroupProps {
  store: SlidesStore | null;
  editor: SlidesEditor | null;
}

/**
 * "+ Slide ▾" split-button lifted from the old SlidesFormattingToolbar.
 * Primary button adds a blank slide; the chevron opens the layout picker.
 */
export function SlideGroup({ store, editor }: SlideGroupProps) {
  const layoutChevronRef = useRef<HTMLButtonElement | null>(null);
  const pickerCloseRef = useRef<(() => void) | null>(null);

  // Insert after the current slide and move the editor to it — matches
  // right-click "New slide" and Cmd+M. The editor's current slide is
  // editor state, not derived from the store, so without setCurrentSlide
  // the canvas would stay on the old slide and the new one would land at
  // the end of the deck, off-screen.
  const addSlideAfterCurrent = useCallback(
    (layoutId: string) => {
      if (!store) return;
      const slides = store.read().slides;
      const currentId = editor?.getCurrentSlideId();
      const currentIdx = currentId
        ? slides.findIndex((s) => s.id === currentId)
        : -1;
      const atIndex = currentIdx >= 0 ? currentIdx + 1 : undefined;
      let newId = "";
      store.batch(() => {
        newId = store.addSlide(layoutId, atIndex);
      });
      if (newId) editor?.setCurrentSlide(newId);
    },
    [store, editor],
  );

  const onAddBlankSlide = useCallback(() => {
    addSlideAfterCurrent("blank");
  }, [addSlideAfterCurrent]);

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
        addSlideAfterCurrent(layoutId);
      },
      onClose: () => {
        pickerCloseRef.current = null;
      },
    });
  }, [store, addSlideAfterCurrent]);

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
            className="inline-flex cursor-pointer h-7 w-7 items-center justify-center rounded-l-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconPlus size={16} />
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
            className="inline-flex cursor-pointer h-7 w-6 items-center justify-center rounded-r-md border-l hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconChevronDown size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Choose a layout</TooltipContent>
      </Tooltip>
    </div>
  );
}
