/**
 * Shared text-format controls: Bold / Italic / Underline / Strikethrough,
 * Text color, Highlight color, Link. Shared between the docs toolbar and
 * the slides text-edit state toolbar.
 */

import { useCallback } from "react";
import type { TextFormattingEditor } from "./types";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconTypography,
  IconHighlight,
  IconLink,
} from "@tabler/icons-react";
import { TEXT_COLORS, BG_COLORS } from "@/components/formatting-colors";
import { ColorPickerGrid } from "@/components/color-picker-grid";
import { modKey } from "./platform";

interface TextFormatGroupProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
}

export function TextFormatGroup({ editor, disabled = false }: TextFormatGroupProps) {
  const selectionStyle = editor?.getSelectionStyle();

  const toggleBold = useCallback(() => {
    if (!editor) return;
    const current = editor.getSelectionStyle();
    editor.applyStyle({ bold: !current.bold });
  }, [editor]);

  const toggleItalic = useCallback(() => {
    if (!editor) return;
    const current = editor.getSelectionStyle();
    editor.applyStyle({ italic: !current.italic });
  }, [editor]);

  const toggleUnderline = useCallback(() => {
    if (!editor) return;
    const current = editor.getSelectionStyle();
    editor.applyStyle({ underline: !current.underline });
  }, [editor]);

  const toggleStrike = useCallback(() => {
    if (!editor) return;
    const current = editor.getSelectionStyle();
    editor.applyStyle({ strikethrough: !current.strikethrough });
  }, [editor]);

  const handleTextColor = useCallback(
    (color: string) => {
      if (!editor) return;
      editor.applyStyle({ color });
      editor.focus();
    },
    [editor]
  );

  const handleHighlightColor = useCallback(
    (backgroundColor: string) => {
      if (!editor) return;
      editor.applyStyle({ backgroundColor });
      editor.focus();
    },
    [editor]
  );

  const handleInsertLink = useCallback(() => {
    if (!editor) return;
    editor.requestLink();
  }, [editor]);

  const isDisabled = disabled || !editor;

  return (
    <>
      {/* Bold */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={!!selectionStyle?.bold}
            onPressedChange={toggleBold}
            className="h-7 w-7 cursor-pointer"
            aria-label="Bold"
            disabled={isDisabled}
          >
            <IconBold size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Bold ({modKey}+B)</TooltipContent>
      </Tooltip>

      {/* Italic */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={!!selectionStyle?.italic}
            onPressedChange={toggleItalic}
            className="h-7 w-7 cursor-pointer"
            aria-label="Italic"
            disabled={isDisabled}
          >
            <IconItalic size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Italic ({modKey}+I)</TooltipContent>
      </Tooltip>

      {/* Underline */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={!!selectionStyle?.underline}
            onPressedChange={toggleUnderline}
            className="h-7 w-7 cursor-pointer"
            aria-label="Underline"
            disabled={isDisabled}
          >
            <IconUnderline size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Underline ({modKey}+U)</TooltipContent>
      </Tooltip>

      {/* Strikethrough */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={!!selectionStyle?.strikethrough}
            onPressedChange={toggleStrike}
            className="h-7 w-7 cursor-pointer"
            aria-label="Strikethrough"
            disabled={isDisabled}
          >
            <IconStrikethrough size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Strikethrough</TooltipContent>
      </Tooltip>

      {/* Text color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Text color"
                disabled={isDisabled}
              >
                <IconTypography size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-auto p-2">
          <ColorPickerGrid
            colors={TEXT_COLORS}
            onSelect={handleTextColor}
            onReset={() => handleTextColor("")}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Highlight color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Highlight color"
                disabled={isDisabled}
              >
                <IconHighlight size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Highlight color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-auto p-2">
          <ColorPickerGrid
            colors={BG_COLORS}
            onSelect={handleHighlightColor}
            onReset={() => handleHighlightColor("")}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Link */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleInsertLink}
            aria-label="Insert link"
            disabled={isDisabled}
          >
            <IconLink size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Insert link ({modKey}+K)</TooltipContent>
      </Tooltip>
    </>
  );
}
