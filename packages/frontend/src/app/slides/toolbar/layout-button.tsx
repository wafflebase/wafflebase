import { useCallback, useEffect, useRef } from 'react';
import { IconLayoutGrid, IconChevronDown } from '@tabler/icons-react';
import { showLayoutPicker } from '@wafflebase/slides';
import type { SlidesEditor, SlidesStore } from '@wafflebase/slides';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

export interface LayoutButtonProps {
  store: SlidesStore | null;
  editor: SlidesEditor | null;
}

/**
 * "Layout ▾" — opens the layout picker preselected to the current slide's
 * layout and applies the pick via `store.applyLayout`. Separate from the
 * `+ Slide ▾` split-button (which inserts a NEW slide with the chosen
 * layout): this one changes the CURRENT slide's layout in place. The
 * popover is anchored to the trigger and toggled via the same close-ref
 * pattern as `SlideGroup`'s chevron.
 */
export function LayoutButton({ store, editor }: LayoutButtonProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const onClick = useCallback(() => {
    const slideId = editor?.getCurrentSlideId();
    if (!store || !slideId) return;
    if (closeRef.current) {
      closeRef.current();
      return;
    }
    const slide = store.read().slides.find((s) => s.id === slideId);
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    closeRef.current = showLayoutPicker(document.body, {
      store,
      trigger: el,
      anchor: { x: rect.left, y: rect.bottom + 4 },
      selectedLayoutId: slide?.layoutId,
      onPick: (layoutId) => {
        store.batch(() => store.applyLayout(slideId, layoutId));
      },
      onClose: () => {
        closeRef.current = null;
      },
    });
  }, [store, editor]);

  useEffect(() => () => closeRef.current?.(), []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          onClick={onClick}
          disabled={!store || !editor}
          aria-label="Layout"
          className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <IconLayoutGrid size={16} />
          <IconChevronDown size={12} className="ml-0.5 opacity-50" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Change layout of current slide</TooltipContent>
    </Tooltip>
  );
}
