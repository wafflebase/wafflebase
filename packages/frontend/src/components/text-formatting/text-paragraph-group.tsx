/**
 * Shared paragraph controls: Alignment dropdown, Numbered/Bulleted list,
 * Indent decrease / increase. Shared between the docs toolbar and the
 * slides text-edit state toolbar.
 */

import { useCallback } from "react";
import type { TextFormattingEditor } from "./types";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignJustified,
  IconChevronDown,
  IconList,
  IconListNumbers,
  IconIndentDecrease,
  IconIndentIncrease,
} from "@tabler/icons-react";
import { modKey } from "./platform";

interface TextParagraphGroupProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
}

export function TextParagraphGroup({ editor, disabled = false }: TextParagraphGroupProps) {
  const handleAlign = useCallback(
    (alignment: "left" | "center" | "right" | "justify") => {
      if (!editor) return;
      editor.applyBlockStyle({ alignment });
      editor.focus();
    },
    [editor]
  );

  const isDisabled = disabled || !editor;

  return (
    <>
      {/* Alignment dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Text alignment"
                disabled={isDisabled}
                data-text-edit-keepalive
              >
                <IconAlignLeft size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text alignment</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          className="w-[200px]"
          data-text-edit-keepalive
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem
            className="flex items-center justify-between"
            onClick={() => handleAlign("left")}
          >
            <span className="flex items-center">
              <IconAlignLeft size={16} className="mr-2" />
              Left
            </span>
            <span className="text-[11px] text-muted-foreground">
              {modKey}+⇧L
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center justify-between"
            onClick={() => handleAlign("center")}
          >
            <span className="flex items-center">
              <IconAlignCenter size={16} className="mr-2" />
              Center
            </span>
            <span className="text-[11px] text-muted-foreground">
              {modKey}+⇧E
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center justify-between"
            onClick={() => handleAlign("right")}
          >
            <span className="flex items-center">
              <IconAlignRight size={16} className="mr-2" />
              Right
            </span>
            <span className="text-[11px] text-muted-foreground">
              {modKey}+⇧R
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center justify-between"
            onClick={() => handleAlign("justify")}
          >
            <span className="flex items-center">
              <IconAlignJustified size={16} className="mr-2" />
              Justify
            </span>
            <span className="text-[11px] text-muted-foreground">
              {modKey}+⇧J
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Numbered list */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor?.toggleList("ordered");
              editor?.focus();
            }}
            aria-label="Numbered list"
            disabled={isDisabled}
          >
            <IconListNumbers size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Numbered list ({modKey}+⇧7)</TooltipContent>
      </Tooltip>

      {/* Bulleted list */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor?.toggleList("unordered");
              editor?.focus();
            }}
            aria-label="Bulleted list"
            disabled={isDisabled}
          >
            <IconList size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Bulleted list ({modKey}+⇧8)</TooltipContent>
      </Tooltip>

      {/* Decrease indent */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor?.outdent();
              editor?.focus();
            }}
            aria-label="Decrease indent"
            disabled={isDisabled}
          >
            <IconIndentDecrease size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Decrease indent ({modKey}+[)</TooltipContent>
      </Tooltip>

      {/* Increase indent */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor?.indent();
              editor?.focus();
            }}
            aria-label="Increase indent"
            disabled={isDisabled}
          >
            <IconIndentIncrease size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Increase indent ({modKey}+])</TooltipContent>
      </Tooltip>
    </>
  );
}
