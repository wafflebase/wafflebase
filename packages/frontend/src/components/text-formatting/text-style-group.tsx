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

/** Style option for the block-type dropdown (Google Docs style). */
interface StyleOption {
  label: string;
  type: BlockType;
  headingLevel?: HeadingLevel;
  className: string;
  shortcut?: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    label: "Normal text",
    type: "paragraph",
    className: "text-[13px]",
    shortcut: "⌥0",
  },
  {
    label: "Title",
    type: "title",
    className: "text-[22px] leading-tight",
  },
  {
    label: "Subtitle",
    type: "subtitle",
    className: "text-[13px] text-muted-foreground",
  },
  {
    label: "Heading 1",
    type: "heading",
    headingLevel: 1,
    className: "text-[18px] font-bold",
    shortcut: "⌥1",
  },
  {
    label: "Heading 2",
    type: "heading",
    headingLevel: 2,
    className: "text-[16px] font-bold",
    shortcut: "⌥2",
  },
  {
    label: "Heading 3",
    type: "heading",
    headingLevel: 3,
    className: "text-[14px] font-bold",
    shortcut: "⌥3",
  },
];

function getBlockLabel(type: BlockType, headingLevel?: HeadingLevel): string {
  if (type === "title") return "Title";
  if (type === "subtitle") return "Subtitle";
  if (type === "heading" && headingLevel) return `Heading ${headingLevel}`;
  return "Normal text";
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

interface TextStyleGroupProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
}

export function TextStyleGroup({ editor, disabled = false }: TextStyleGroupProps) {
  const handleBlockType = (
    type: BlockType,
    opts?: { headingLevel?: HeadingLevel }
  ) => {
    if (!editor) return;
    editor.setBlockType(type, opts);
    editor.focus();
  };

  const blockType = editor ? editor.getBlockType() : null;

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
        {STYLE_OPTIONS.map((opt) => (
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
