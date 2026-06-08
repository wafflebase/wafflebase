/**
 * Shared paragraph controls: Alignment dropdown, Numbered/Bulleted list,
 * Indent decrease / increase. Shared between the docs toolbar and the
 * slides text-edit state toolbar.
 */

import { useCallback, useRef } from "react";
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

  // Same deferral pattern as FontFamilyPicker: stash the pick on click,
  // replay it from `onCloseAutoFocus` so the caller's `editor.focus()`
  // runs after Radix's FocusScope teardown and sticks.
  const pendingAlignRef = useRef<
    "left" | "center" | "right" | "justify" | null
  >(null);

  const isDisabled = disabled || !editor;

  // Mirror the current paragraph alignment on the trigger icon so the
  // toolbar reads the user's state at a glance. Falls back to Left when
  // unset — matches the renderer's default.
  const alignment = editor?.getBlockStyle?.()?.alignment ?? "left";
  const AlignIcon =
    alignment === "center"
      ? IconAlignCenter
      : alignment === "right"
        ? IconAlignRight
        : alignment === "justify"
          ? IconAlignJustified
          : IconAlignLeft;

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
                <AlignIcon size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text alignment</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          className="w-[200px]"
          data-text-edit-keepalive
          onCloseAutoFocus={(e) => {
            const pick = pendingAlignRef.current;
            if (pick === null) {
              // No pick — let Radix restore focus to the trigger so
              // Esc / outside-click dismiss does not strand focus on
              // <body>.
              return;
            }
            e.preventDefault();
            pendingAlignRef.current = null;
            handleAlign(pick);
          }}
        >
          <DropdownMenuItem
            className="flex items-center justify-between"
            onClick={() => {
              pendingAlignRef.current = "left";
            }}
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
            onClick={() => {
              pendingAlignRef.current = "center";
            }}
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
            onClick={() => {
              pendingAlignRef.current = "right";
            }}
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
            onClick={() => {
              pendingAlignRef.current = "justify";
            }}
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
