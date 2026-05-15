/**
 * Shared text style controls: block-type dropdown (Normal text, Heading 1–3,
 * Title, Subtitle). Shared between the docs toolbar and the slides text-edit
 * state toolbar.
 */

import type { BlockType, HeadingLevel } from "@wafflebase/docs";
import type { TextFormattingEditor } from "./types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconChevronDown } from "@tabler/icons-react";
import { getFilteredStyleOptions, getBlockLabel } from "./text-style-options";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

interface TextStyleGroupProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
  /**
   * When provided, only block-type options whose `type` is in this list are
   * rendered. Omit (or pass `undefined`) to show the full set — preserves
   * existing docs toolbar behaviour with no change.
   *
   * Task 11 (slides toolbar) will pass something like
   * `['paragraph', 'heading']` to hide Title/Subtitle which silently no-op
   * inside text boxes.
   */
  allowedBlockTypes?: ReadonlyArray<BlockType>;
}

export function TextStyleGroup({
  editor,
  disabled = false,
  allowedBlockTypes,
}: TextStyleGroupProps) {
  const handleBlockType = (
    type: BlockType,
    opts?: { headingLevel?: HeadingLevel }
  ) => {
    if (!editor) return;
    editor.setBlockType(type, opts);
    editor.focus();
  };

  const blockType = editor ? editor.getBlockType() : null;
  const visibleOptions = getFilteredStyleOptions(allowedBlockTypes);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex h-7 min-w-[110px] cursor-pointer items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Text style"
              disabled={disabled || !editor}
            >
              <span className="truncate">
                {blockType
                  ? getBlockLabel(blockType.type, blockType.headingLevel)
                  : "Normal text"}
              </span>
              <IconChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Styles</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-[210px]">
        {visibleOptions.map((opt) => (
          <DropdownMenuItem
            key={opt.label}
            className="flex items-center justify-between py-1"
            onClick={() =>
              handleBlockType(
                opt.type,
                opt.headingLevel ? { headingLevel: opt.headingLevel } : undefined
              )
            }
          >
            <span className={opt.className}>{opt.label}</span>
            {opt.shortcut && (
              <span className="ml-4 text-[11px] text-muted-foreground">
                {modKey}+{opt.shortcut}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
