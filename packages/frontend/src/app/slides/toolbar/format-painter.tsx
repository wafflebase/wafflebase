import { useEffect, useState } from "react";
import { IconBrush } from "@tabler/icons-react";
import type { SlidesEditor } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export interface FormatPainterButtonProps {
  editor: SlidesEditor | null;
}

/**
 * Single-shot format painter toggle.
 *
 * - Pressed → `editor.beginFormatPaint()` captures fill / stroke from
 *   the single selected element. The editor pastes onto the next
 *   pointer-down on a compatible element, then auto-exits paint mode.
 * - Re-press while painting → `cancelFormatPaint()`.
 * - Esc inside the canvas also cancels (wired in
 *   `view/editor/interactions/keyboard.ts`).
 *
 * The button stays clickable even with multi-select or empty
 * selection because `beginFormatPaint` is itself a no-op in those
 * cases — keeping the disabled state attached to the editor's
 * eligibility check would mean recomputing it on every selection
 * change just for this affordance.
 */
export function FormatPainterButton({ editor }: FormatPainterButtonProps) {
  const [active, setActive] = useState<boolean>(
    editor?.isPaintingFormat() ?? false,
  );

  useEffect(() => {
    if (!editor) {
      setActive(false);
      return;
    }
    setActive(editor.isPaintingFormat());
    return editor.onPaintFormatChange(() => setActive(editor.isPaintingFormat()));
  }, [editor]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={active}
          onPressedChange={(pressed) => {
            if (!editor) return;
            if (pressed) editor.beginFormatPaint();
            else editor.cancelFormatPaint();
          }}
          aria-label="Format painter"
          disabled={!editor}
        >
          <IconBrush size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Format painter</TooltipContent>
    </Tooltip>
  );
}
