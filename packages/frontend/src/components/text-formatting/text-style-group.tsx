/**
 * Shared text style controls: block-type dropdown (Normal text, Title,
 * Subtitle, Heading 1–6). Shared between the docs toolbar and the slides
 * text-edit state toolbar.
 *
 * When the editor supports named styles (docs `EditorAPI`), an "Options"
 * submenu adds Google-Docs-style redefine / reset / save-default actions.
 * Slides text-box editors omit those methods, so the submenu is hidden and
 * the dropdown stays a plain one-click block-type picker.
 */

import { useRef } from "react";
import type { BlockType, HeadingLevel } from "@wafflebase/docs";
import type { TextFormattingEditor } from "./types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconChevronDown } from "@tabler/icons-react";
import {
  getFilteredStyleOptions,
  getBlockLabel,
  blockTypeToStyleId,
} from "./text-style-options";
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
  /**
   * "Save as my default styles" — persist the current document registry to
   * the user account. Omit to hide the entry (e.g. when unauthenticated).
   */
  onSaveDefaultStyles?: () => void;
  /** "Use my default styles" — load the saved registry into the document. */
  onUseDefaultStyles?: () => void;
}

export function TextStyleGroup({
  editor,
  disabled = false,
  allowedBlockTypes,
  onSaveDefaultStyles,
  onUseDefaultStyles,
}: TextStyleGroupProps) {
  // Stash the action on click, replay it from `onCloseAutoFocus` so the
  // caller's `editor.focus()` runs after Radix's FocusScope teardown and
  // sticks (same deferral pattern as FontFamilyPicker).
  const pendingActionRef = useRef<(() => void) | null>(null);

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

  // Named-style redefinition is docs-only (slides text-boxes omit the
  // methods). Gate the whole Options submenu on capability detection.
  const supportsNamedStyles = !!editor?.updateStyleToMatch;
  const currentLabel = blockType
    ? getBlockLabel(blockType.type, blockType.headingLevel)
    : "Normal text";
  const currentStyleId = blockType
    ? blockTypeToStyleId(blockType.type, blockType.headingLevel)
    : "normal";

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
              <span className="truncate">{currentLabel}</span>
              <IconChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Styles</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-[230px]"
        data-text-edit-keepalive
        onCloseAutoFocus={(e) => {
          const action = pendingActionRef.current;
          if (action === null) {
            // No pick — let Radix restore focus to the trigger so Esc /
            // outside-click dismiss does not strand focus on <body>.
            return;
          }
          e.preventDefault();
          pendingActionRef.current = null;
          action();
        }}
      >
        {visibleOptions.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.label}
            checked={opt.styleId === currentStyleId}
            className="flex items-center justify-between py-1"
            onClick={() => {
              pendingActionRef.current = () =>
                handleBlockType(
                  opt.type,
                  opt.headingLevel
                    ? { headingLevel: opt.headingLevel }
                    : undefined
                );
            }}
          >
            <span className={opt.className}>{opt.label}</span>
            {opt.shortcut && (
              <span className="ml-4 text-[11px] text-muted-foreground">
                {modKey}+{opt.shortcut}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}

        {supportsNamedStyles && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[230px]">
                <DropdownMenuItem
                  onClick={() => {
                    pendingActionRef.current = () => {
                      editor?.updateStyleToMatch?.(currentStyleId);
                      editor?.focus();
                    };
                  }}
                >
                  {`Update '${currentLabel}' to match`}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    pendingActionRef.current = () => {
                      editor?.resetNamedStyle?.(currentStyleId);
                      editor?.focus();
                    };
                  }}
                >
                  {`Reset '${currentLabel}'`}
                </DropdownMenuItem>
                {(onSaveDefaultStyles || onUseDefaultStyles) && (
                  <DropdownMenuSeparator />
                )}
                {onSaveDefaultStyles && (
                  <DropdownMenuItem
                    onClick={() => {
                      pendingActionRef.current = () => {
                        onSaveDefaultStyles();
                        editor?.focus();
                      };
                    }}
                  >
                    Save as my default styles
                  </DropdownMenuItem>
                )}
                {onUseDefaultStyles && (
                  <DropdownMenuItem
                    onClick={() => {
                      pendingActionRef.current = () => {
                        onUseDefaultStyles();
                        editor?.focus();
                      };
                    }}
                  >
                    Use my default styles
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    pendingActionRef.current = () => {
                      editor?.resetAllNamedStyles?.();
                      editor?.focus();
                    };
                  }}
                >
                  Reset styles
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
