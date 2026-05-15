import { useCallback } from 'react';
import type { SlidesEditor, SlidesStore, Theme, ThemeColor } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import { IconColorSwatch } from '@tabler/icons-react';
import { InsertGroup } from './insert-group';
import { ThemedColorPicker } from '../themed-color-picker';

export interface IdleSectionProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  onImagePick: () => void;
}

export function IdleSection({ editor, store, theme, onImagePick }: IdleSectionProps) {
  const slideId = editor?.getCurrentSlideId();

  const onBackgroundChange = useCallback(
    (color: ThemeColor) => {
      if (!store || !slideId) return;
      store.batch(() => store.updateSlideBackground(slideId, { fill: color }));
    },
    [store, slideId],
  );

  return (
    <>
      <InsertGroup editor={editor} onImagePick={onImagePick} disabled={!editor} />
      <ToolbarSeparator className="mx-1" />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Slide background"
                disabled={!store || !slideId || !theme}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              >
                <IconColorSwatch size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Slide background</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-auto p-2">
          {theme && (
            <ThemedColorPicker
              value={undefined}
              theme={theme}
              onChange={onBackgroundChange}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
