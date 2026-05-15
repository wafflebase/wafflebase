import { useCallback, useState } from 'react';
import type { ImageElement, SlidesEditor, SlidesStore } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import {
  IconReplace,
  IconCrop,
  IconArrowBackUp,
  IconAccessible,
} from '@tabler/icons-react';
import { replaceImageOnSlide } from '../replace-image';

export interface ImageControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  ids: readonly string[];
  /** Upload pipeline injected from the parent (wired in Task 12). */
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/**
 * Contextual toolbar controls for a selected image element.
 *
 * - Replace: opens a hidden file input, uploads, and swaps src + clears crop.
 * - Crop: disabled placeholder — full crop UI is deferred to a separate spec.
 * - Reset crop: clears the crop field (enabled only when a crop exists).
 * - Alt text: DropdownMenu with a textarea to set accessibility text.
 */
export function ImageControls({
  editor,
  store,
  ids,
  upload,
}: ImageControlsProps) {
  const slideId = editor?.getCurrentSlideId();
  const firstId = ids[0];

  const slide =
    store && slideId
      ? store.read().slides.find((s) => s.id === slideId)
      : undefined;
  const image = slide?.elements.find(
    (e) => e.id === firstId && e.type === 'image',
  ) as ImageElement | undefined;

  const onReplace = useCallback(async () => {
    if (!store || !slideId || !upload) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await replaceImageOnSlide({
        store,
        slideId,
        elementId: firstId,
        file,
        upload,
      });
    };
    input.click();
  }, [store, slideId, firstId, upload]);

  const onResetCrop = useCallback(() => {
    if (!store || !slideId) return;
    store.batch(() =>
      store.updateElementData(slideId, firstId, { crop: undefined }),
    );
  }, [store, slideId, firstId]);

  const onSaveAlt = useCallback(
    (alt: string) => {
      if (!store || !slideId) return;
      store.batch(() =>
        store.updateElementData(slideId, firstId, { alt }),
      );
    },
    [store, slideId, firstId],
  );

  const hasCrop = !!image?.data.crop;

  return (
    <>
      {/* Replace */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onReplace}
            aria-label="Replace image"
            disabled={!store || !slideId || !upload}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconReplace size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Replace image</TooltipContent>
      </Tooltip>

      {/* Crop — disabled placeholder; full UI deferred to a separate spec */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            aria-label="Crop image (coming soon)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconCrop size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Crop (coming soon)</TooltipContent>
      </Tooltip>

      {/* Reset crop */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onResetCrop}
            aria-label="Reset crop"
            disabled={!hasCrop}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconArrowBackUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Reset crop</TooltipContent>
      </Tooltip>

      <ToolbarSeparator className="mx-1" />

      {/* Alt text */}
      <AltTextDropdown
        value={image?.data.alt ?? ''}
        onSave={onSaveAlt}
        disabled={!store || !slideId}
      />
    </>
  );
}

interface AltTextDropdownProps {
  value: string;
  onSave: (alt: string) => void;
  disabled: boolean;
}

function AltTextDropdown({ value, onSave, disabled }: AltTextDropdownProps) {
  const [draft, setDraft] = useState(value);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Alt text"
              disabled={disabled}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <IconAccessible size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Alt text (accessibility)</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <label className="block text-xs font-medium">Alt text</label>
        <textarea
          className="mt-1 w-full rounded border p-1 text-sm"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onSave(draft)}
          placeholder="Describe this image for screen readers"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
