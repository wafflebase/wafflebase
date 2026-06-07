/**
 * Shared text-format controls: Bold / Italic / Underline / Strikethrough,
 * Text color, Highlight color, Link. Shared between the docs toolbar and
 * the slides text-edit state toolbar.
 */

import { useCallback, useState } from "react";
import { useMenuCloseHandlers } from "@/components/menu-focus";
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
  IconClearFormatting,
} from "@tabler/icons-react";
import { TEXT_COLORS, BG_COLORS } from "@/components/formatting-colors";
import { ColorPickerGrid } from "@/components/color-picker-grid";
import { ColorSwatchButton } from "@/components/color-swatch-button";
import { InsertLinkButton } from "./insert-link-button";
import { modKey } from "./platform";

interface TextFormatGroupProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
  /**
   * Whether to render the Strikethrough toggle. Defaults to `true` so the
   * slides text-edit-state toolbar keeps it. The Docs body toolbar opts
   * out by passing `false` to keep the inline-format row compact (B/I/U
   * is the primary trio there; strike is rarely a first-class need).
   */
  showStrikethrough?: boolean;
  /**
   * Whether to render the Insert link button. Defaults to `true` so the
   * slides text-edit toolbar (a single Format cluster) keeps it. The
   * Docs toolbar opts out by passing `false` and places its own
   * `InsertLinkButton` in the Insert group beside Image/Table.
   */
  showLink?: boolean;
  /**
   * CSS color string used by the Text color swatch when the current
   * selection has no explicit `color`. Lets docs preview the rendered
   * default (e.g. `var(--wb-ink)` which flips between light and dark
   * themes). Undefined keeps the outlined "no value" slot — appropriate
   * for slides text-boxes where the rendered default comes from the
   * theme, not from a stable CSS variable.
   */
  defaultTextColor?: string;
  /**
   * CSS color string used by the Highlight swatch when no background
   * color is set. See `defaultTextColor`.
   */
  defaultHighlightColor?: string;
}

export function TextFormatGroup({
  editor,
  disabled = false,
  showStrikethrough = true,
  showLink = true,
  defaultTextColor,
  defaultHighlightColor,
}: TextFormatGroupProps) {
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

  // Controlled open state so the swatch click closes the palette — the
  // color swatches are plain <button>s, not DropdownMenuItem.
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);

  // Refocus the editor caret only when the palette was closed by a swatch
  // click. Outside-click / Esc fall through, so they don't steal focus
  // from wherever the user actually clicked next.
  const textColorMenu = useMenuCloseHandlers(() => editor?.focus());
  const highlightMenu = useMenuCloseHandlers(() => editor?.focus());

  const handleTextColor = useCallback(
    (color: string) => {
      if (!editor) return;
      editor.applyStyle({ color });
      textColorMenu.markSwatchClicked();
      setTextColorOpen(false);
    },
    [editor, textColorMenu]
  );

  const handleHighlightColor = useCallback(
    (backgroundColor: string) => {
      if (!editor) return;
      editor.applyStyle({ backgroundColor });
      highlightMenu.markSwatchClicked();
      setHighlightOpen(false);
    },
    [editor, highlightMenu]
  );

  const handleInsertLink = useCallback(() => {
    if (!editor) return;
    editor.requestLink();
  }, [editor]);

  const handleClearFormatting = useCallback(() => {
    if (!editor) return;
    editor.clearInlineFormatting();
    editor.focus();
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
            onMouseDown={(e) => e.preventDefault()}
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
            onMouseDown={(e) => e.preventDefault()}
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
            onMouseDown={(e) => e.preventDefault()}
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
      {showStrikethrough && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={!!selectionStyle?.strikethrough}
              onPressedChange={toggleStrike}
              onMouseDown={(e) => e.preventDefault()}
              className="h-7 w-7 cursor-pointer"
              aria-label="Strikethrough"
              disabled={isDisabled}
            >
              <IconStrikethrough size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Strikethrough</TooltipContent>
        </Tooltip>
      )}

      {/* Text color */}
      <DropdownMenu open={textColorOpen} onOpenChange={setTextColorOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ColorSwatchButton
                icon={<IconTypography size={14} />}
                color={selectionStyle?.color || defaultTextColor}
                label="Text color"
                disabled={isDisabled}
                data-text-edit-keepalive
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          className="w-auto p-2"
          data-text-edit-keepalive
          onCloseAutoFocus={textColorMenu.onCloseAutoFocus}
        >
          <ColorPickerGrid
            colors={TEXT_COLORS}
            onSelect={handleTextColor}
            onReset={() => handleTextColor("")}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Highlight color */}
      <DropdownMenu open={highlightOpen} onOpenChange={setHighlightOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ColorSwatchButton
                icon={<IconHighlight size={14} />}
                color={selectionStyle?.backgroundColor || defaultHighlightColor}
                label="Highlight color"
                disabled={isDisabled}
                data-text-edit-keepalive
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Highlight color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          className="w-auto p-2"
          data-text-edit-keepalive
          onCloseAutoFocus={highlightMenu.onCloseAutoFocus}
        >
          <ColorPickerGrid
            colors={BG_COLORS}
            onSelect={handleHighlightColor}
            onReset={() => handleHighlightColor("")}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Link */}
      {showLink && (
        <InsertLinkButton onClick={handleInsertLink} disabled={isDisabled} />
      )}

      {/* Clear formatting */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClearFormatting}
            aria-label="Clear formatting"
            disabled={isDisabled}
            data-text-edit-keepalive
          >
            <IconClearFormatting size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Clear formatting</TooltipContent>
      </Tooltip>
    </>
  );
}
