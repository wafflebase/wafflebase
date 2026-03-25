import { useCallback } from "react";
import type { BlockType, EditorAPI, HeadingLevel } from "@wafflebase/docs";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
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
import { TEXT_COLORS } from "@/components/formatting-colors";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconTypography,
  IconDropletOff,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconList,
  IconListNumbers,
  IconIndentDecrease,
  IconIndentIncrease,
} from "@tabler/icons-react";

/** Style option for the block-type dropdown (Google Docs style). */
interface StyleOption {
  label: string;
  type: BlockType;
  headingLevel?: HeadingLevel;
  className: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  { label: "Normal text", type: "paragraph", className: "text-[13px]" },
  { label: "Title", type: "title", className: "text-[22px] leading-tight" },
  { label: "Subtitle", type: "subtitle", className: "text-[13px] text-muted-foreground" },
  { label: "Heading 1", type: "heading", headingLevel: 1, className: "text-[18px] font-bold" },
  { label: "Heading 2", type: "heading", headingLevel: 2, className: "text-[16px] font-bold" },
  { label: "Heading 3", type: "heading", headingLevel: 3, className: "text-[14px] font-bold" },
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

interface DocsFormattingToolbarProps {
  editor: EditorAPI | null;
}

export function DocsFormattingToolbar({ editor }: DocsFormattingToolbarProps) {
  const handleUndo = useCallback(() => editor?.undo(), [editor]);
  const handleRedo = useCallback(() => editor?.redo(), [editor]);

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

  const toggleStrikethrough = useCallback(() => {
    if (!editor) return;
    const current = editor.getSelectionStyle();
    editor.applyStyle({ strikethrough: !current.strikethrough });
  }, [editor]);

  const handleBlockType = useCallback(
    (type: BlockType, opts?: { headingLevel?: HeadingLevel }) => {
      editor?.setBlockType(type, opts);
      editor?.focus();
    },
    [editor],
  );

  const handleAlign = useCallback(
    (alignment: "left" | "center" | "right") => {
      editor?.applyBlockStyle({ alignment });
      editor?.focus();
    },
    [editor],
  );

  const handleTextColor = useCallback(
    (color: string) => {
      editor?.applyStyle({ color });
      editor?.focus();
    },
    [editor],
  );

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap">
      {/* ── Undo / Redo ── */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleUndo}
            aria-label="Undo"
          >
            <IconArrowBackUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Undo ({modKey}+Z)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleRedo}
            aria-label="Redo"
          >
            <IconArrowForwardUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Redo ({modKey}+{isMac ? "⇧Z" : "Y"})
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* ── Styles ── */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 min-w-[110px] cursor-pointer items-center justify-between rounded-md px-2 text-xs hover:bg-muted"
                aria-label="Text style"
              >
                <span className="truncate">
                  {editor ? getBlockLabel(
                    editor.getBlockType().type,
                    editor.getBlockType().headingLevel,
                  ) : "Normal text"}
                </span>
                <IconChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Styles</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-[180px]">
          {STYLE_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.label}
              className="py-1"
              onClick={() => handleBlockType(opt.type, opt.headingLevel ? { headingLevel: opt.headingLevel } : undefined)}
            >
              <span className={opt.className}>{opt.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* ── Font Styles ── */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            onPressedChange={toggleBold}
            className="h-7 w-7 cursor-pointer"
            aria-label="Bold"
          >
            <IconBold size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Bold ({modKey}+B)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            onPressedChange={toggleItalic}
            className="h-7 w-7 cursor-pointer"
            aria-label="Italic"
          >
            <IconItalic size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Italic ({modKey}+I)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            onPressedChange={toggleUnderline}
            className="h-7 w-7 cursor-pointer"
            aria-label="Underline"
          >
            <IconUnderline size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Underline ({modKey}+U)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            onPressedChange={toggleStrikethrough}
            className="h-7 w-7 cursor-pointer"
            aria-label="Strikethrough"
          >
            <IconStrikethrough size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Strikethrough</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                aria-label="Text color"
              >
                <IconTypography size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-auto p-2">
          <button
            className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            onClick={() => handleTextColor("")}
          >
            <IconDropletOff size={14} />
            Reset
          </button>
          <div className="grid grid-cols-5 gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                className="h-5 w-5 cursor-pointer rounded border border-border hover:scale-125 transition-transform"
                style={{ backgroundColor: color }}
                onClick={() => handleTextColor(color)}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* ── Block Styles ── */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted"
                aria-label="Text alignment"
              >
                <IconAlignLeft size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text alignment</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => handleAlign("left")}>
            <IconAlignLeft size={16} className="mr-2" />
            Left
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAlign("center")}>
            <IconAlignCenter size={16} className="mr-2" />
            Center
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAlign("right")}>
            <IconAlignRight size={16} className="mr-2" />
            Right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={() => { editor?.toggleList("unordered"); editor?.focus(); }}
            aria-label="Bulleted list"
          >
            <IconList size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Bulleted list</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={() => { editor?.toggleList("ordered"); editor?.focus(); }}
            aria-label="Numbered list"
          >
            <IconListNumbers size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Numbered list</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={() => { editor?.outdent(); editor?.focus(); }}
            aria-label="Decrease indent"
          >
            <IconIndentDecrease size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Decrease indent</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={() => { editor?.indent(); editor?.focus(); }}
            aria-label="Increase indent"
          >
            <IconIndentIncrease size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Increase indent</TooltipContent>
      </Tooltip>
    </div>
  );
}
