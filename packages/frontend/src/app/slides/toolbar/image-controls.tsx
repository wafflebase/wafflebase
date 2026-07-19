import { useCallback, useEffect, useState } from 'react';
import type { ImageElement, SlidesEditor, SlidesStore } from '@wafflebase/slides';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ToolbarButton } from '@/components/ui/toolbar';
import { toast } from 'sonner';
import {
  IconReplace,
  IconCrop,
  IconArrowBackUp,
} from '@tabler/icons-react';
import { replaceImageOnSlide } from '../replace-image';

export interface ImageControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  ids: readonly string[];
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/**
 * Contextual toolbar controls for a selected image element.
 *
 * - Replace: opens a hidden file input, uploads, and swaps src + clears crop.
 * - Crop: enters the interactive crop session (drag the black handles to
 *   trim, drag the image to pan; Enter / click-outside commits, Esc cancels).
 *   Toggles the session off when already cropping.
 * - Reset crop: clears the crop and restores the image's proportions
 *   (enabled only when a crop exists).
 *
 * Alt text moved to the Format panel's Alt text section — the panel is
 * the single home for image accessibility metadata.
 */
export function ImageControls({
  editor,
  store,
  ids,
  upload,
}: ImageControlsProps) {
  // Track the editor's crop-session state so the Crop button can show a
  // pressed/active affordance while cropping.
  const [cropping, setCropping] = useState(false);
  useEffect(() => {
    if (!editor) {
      setCropping(false);
      return;
    }
    setCropping(editor.isCropping());
    return editor.onCropChange(() => setCropping(editor.isCropping()));
  }, [editor]);

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
      try {
        await replaceImageOnSlide({
          store,
          slideId,
          elementId: firstId,
          file,
          upload,
        });
      } catch (err) {
        console.error('Failed to replace image', err);
        toast.error('Failed to replace image');
      }
    };
    input.click();
  }, [store, slideId, firstId, upload]);

  const onCrop = useCallback(() => {
    if (!editor || !firstId) return;
    if (editor.isCropping()) {
      editor.exitImageCrop(true);
    } else {
      editor.enterImageCrop(firstId);
    }
  }, [editor, firstId]);

  const onResetCrop = useCallback(() => {
    // Clear the crop and restore proportions in one undo step. Routed
    // through the editor so the frame is recomputed from the uncropped
    // bitmap rather than re-stretching the stale cropped frame.
    editor?.resetImageCrop(firstId);
  }, [editor, firstId]);

  const hasCrop = !!image?.data.crop;

  return (
    <>
      {/* Replace */}
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton
            onClick={onReplace}
            aria-label="Replace image"
            disabled={!store || !slideId || !upload}
          >
            <IconReplace size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Replace image</TooltipContent>
      </Tooltip>

      {/* Crop — enter / exit the interactive crop session */}
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton
            onClick={onCrop}
            aria-label="Crop image"
            aria-pressed={cropping}
            disabled={!editor || !firstId || !image}
            className={cropping ? 'bg-muted text-foreground' : ''}
          >
            <IconCrop size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>{cropping ? 'Done cropping' : 'Crop'}</TooltipContent>
      </Tooltip>

      {/* Reset crop */}
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton
            onClick={onResetCrop}
            aria-label="Reset crop"
            disabled={!hasCrop}
          >
            <IconArrowBackUp size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Reset crop</TooltipContent>
      </Tooltip>
    </>
  );
}
