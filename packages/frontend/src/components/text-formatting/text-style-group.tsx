/**
 * Shared text style controls: block-type dropdown (Normal text, Heading 1–3,
 * Title, Subtitle). Shared between the docs toolbar and the slides text-edit
 * state toolbar.
 */

import { useRef } from "react";
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
import { modKey } from "./platform";

interface TextStyleGroupProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
  /**
   * When provided, only block-type options whose `type` is in this list are
   * rendered. Omit (or pass `undefined`) to show the full set. Useful when
   * the hosting editor silently ignores some block types (e.g. text-boxes
   * have no Title/Subtitle); pass `['paragraph', 'heading']` to hide them.
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

  // Same deferral pattern as FontFamilyPicker: stash the pick on click,
  // replay it from `onCloseAutoFocus` so the caller's `editor.focus()`
  // runs after Radix's FocusScope teardown and sticks.
  const pendingPickRef = useRef<{
    type: BlockType;
    headingLevel?: HeadingLevel;
  } | null>(null);

  const blockType = editor ? editor.getBlockType() : null;
  const visibleOptions = getFilteredStyleOptions(allowedBlockTypes);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex h-7 min-w-[100px] cursor-pointer items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Text style"
              disabled={disabled || !editor}
              data-text-edit-keepalive
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
      <DropdownMenuContent
        className="w-[210px]"
        data-text-edit-keepalive
        onCloseAutoFocus={(e) => {
          const pick = pendingPickRef.current;
          if (pick === null) {
            // No pick — let Radix restore focus to the trigger so Esc /
            // outside-click dismiss does not strand focus on <body>.
            return;
          }
          e.preventDefault();
          pendingPickRef.current = null;
          handleBlockType(
            pick.type,
            pick.headingLevel ? { headingLevel: pick.headingLevel } : undefined,
          );
        }}
      >
        {visibleOptions.map((opt) => (
          <DropdownMenuItem
            key={opt.label}
            className="flex items-center justify-between py-1"
            onClick={() => {
              pendingPickRef.current = {
                type: opt.type,
                headingLevel: opt.headingLevel,
              };
            }}
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
