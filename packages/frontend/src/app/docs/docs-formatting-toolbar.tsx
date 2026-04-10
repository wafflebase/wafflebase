import { useCallback, useState } from "react";
import type { BlockType, EditorAPI, EditContext, HeadingLevel } from "@wafflebase/docs";
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
import { TEXT_COLORS, BG_COLORS } from "@/components/formatting-colors";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignJustified,
  IconTypography,
  IconHighlight,
  IconDropletOff,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconList,
  IconListNumbers,
  IconIndentDecrease,
  IconIndentIncrease,
  IconLink,
  IconTable,
  IconHash,
  IconFileDownload,
} from "@tabler/icons-react";
import { TableGridPicker } from "./table-grid-picker";
import { exportDocxAndDownload } from "./docx-actions";
import { toast } from "sonner";

/** Style option for the block-type dropdown (Google Docs style). */
interface StyleOption {
  label: string;
  type: BlockType;
  headingLevel?: HeadingLevel;
  className: string;
  shortcut?: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  { label: "Normal text", type: "paragraph", className: "text-[13px]", shortcut: "⌥0" },
  { label: "Title", type: "title", className: "text-[22px] leading-tight" },
  { label: "Subtitle", type: "subtitle", className: "text-[13px] text-muted-foreground" },
  { label: "Heading 1", type: "heading", headingLevel: 1, className: "text-[18px] font-bold", shortcut: "⌥1" },
  { label: "Heading 2", type: "heading", headingLevel: 2, className: "text-[16px] font-bold", shortcut: "⌥2" },
  { label: "Heading 3", type: "heading", headingLevel: 3, className: "text-[14px] font-bold", shortcut: "⌥3" },
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

function TableDropdown({ editor }: { editor: EditorAPI | null }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
              aria-label="Insert table"
            >
              <IconTable size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Insert table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" sideOffset={4}>
        <TableGridPicker
          onSelect={(rows, cols) => {
            editor?.insertTable(rows, cols);
            editor?.focus();
            setOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DocsFormattingToolbarProps {
  editor: EditorAPI | null;
  editContext?: EditContext;
  documentTitle?: string;
}

export function DocsFormattingToolbar({ editor, editContext = 'body', documentTitle }: DocsFormattingToolbarProps) {
  const [exporting, setExporting] = useState(false);

  const handleExportDocx = useCallback(async () => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      const doc = editor.getStore().getDocument();
      await exportDocxAndDownload(doc, documentTitle ?? "document");
    } catch (err) {
      console.error("DOCX export failed", err);
      toast.error(
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
      );
    } finally {
      setExporting(false);
    }
  }, [editor, documentTitle, exporting]);

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

  const handleInsertLink = useCallback(() => {
    if (!editor) return;
    editor.requestLink();
  }, [editor]);

  const handleBlockType = useCallback(
    (type: BlockType, opts?: { headingLevel?: HeadingLevel }) => {
      editor?.setBlockType(type, opts);
      editor?.focus();
    },
    [editor],
  );

  const handleAlign = useCallback(
    (alignment: "left" | "center" | "right" | "justify") => {
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

  const handleHighlightColor = useCallback(
    (backgroundColor: string) => {
      editor?.applyStyle({ backgroundColor });
      editor?.focus();
    },
    [editor],
  );

  const handleInsertPageNumber = useCallback(() => {
    editor?.insertPageNumber();
    editor?.focus();
  }, [editor]);

  const isHeaderFooter = editContext === 'header' || editContext === 'footer';
  const contextLabel = editContext === 'header' ? 'Header' : 'Footer';

  if (isHeaderFooter) {
    return (
      <div className="flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap">
        <span className="mr-2 text-xs text-muted-foreground">{contextLabel}</span>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ── Font Styles ── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle size="sm" onPressedChange={toggleBold} className="h-7 w-7 cursor-pointer" aria-label="Bold">
              <IconBold size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Bold ({modKey}+B)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle size="sm" onPressedChange={toggleItalic} className="h-7 w-7 cursor-pointer" aria-label="Italic">
              <IconItalic size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Italic ({modKey}+I)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle size="sm" onPressedChange={toggleUnderline} className="h-7 w-7 cursor-pointer" aria-label="Underline">
              <IconUnderline size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Underline ({modKey}+U)</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted" aria-label="Text color">
                  <IconTypography size={16} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Text color</TooltipContent>
          </Tooltip>
          <DropdownMenuContent className="w-auto p-2">
            <button className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted" onClick={() => handleTextColor("")}>
              <IconDropletOff size={14} /> Reset
            </button>
            <div className="grid grid-cols-5 gap-1">
              {TEXT_COLORS.map((color) => (
                <button key={color} className="h-5 w-5 cursor-pointer rounded border border-border hover:scale-125 transition-transform" style={{ backgroundColor: color }} onClick={() => handleTextColor(color)} />
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted" aria-label="Highlight color">
                  <IconHighlight size={16} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Highlight color</TooltipContent>
          </Tooltip>
          <DropdownMenuContent className="w-auto p-2">
            <button className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted" onClick={() => handleHighlightColor("")}>
              <IconDropletOff size={14} /> Reset
            </button>
            <div className="grid grid-cols-5 gap-1">
              {BG_COLORS.map((color) => (
                <button key={color} className="h-5 w-5 cursor-pointer rounded border border-border hover:scale-125 transition-transform" style={{ backgroundColor: color }} onClick={() => handleHighlightColor(color)} />
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ── Alignment ── */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted" aria-label="Text alignment">
                  <IconAlignLeft size={16} />
                  <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Text alignment</TooltipContent>
          </Tooltip>
          <DropdownMenuContent className="w-[200px]">
            <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("left")}>
              <span className="flex items-center"><IconAlignLeft size={16} className="mr-2" />Left</span>
              <span className="text-[11px] text-muted-foreground">{modKey}+⇧L</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("center")}>
              <span className="flex items-center"><IconAlignCenter size={16} className="mr-2" />Center</span>
              <span className="text-[11px] text-muted-foreground">{modKey}+⇧E</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("right")}>
              <span className="flex items-center"><IconAlignRight size={16} className="mr-2" />Right</span>
              <span className="text-[11px] text-muted-foreground">{modKey}+⇧R</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("justify")}>
              <span className="flex items-center"><IconAlignJustified size={16} className="mr-2" />Justify</span>
              <span className="text-[11px] text-muted-foreground">{modKey}+⇧J</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ── Page Number ── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted"
              onClick={handleInsertPageNumber}
              aria-label="Insert page number"
            >
              <IconHash size={16} />
              <span>Page number</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Insert page number</TooltipContent>
        </Tooltip>
      </div>
    );
  }

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
        <DropdownMenuContent className="w-[210px]">
          {STYLE_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.label}
              className="flex items-center justify-between py-1"
              onClick={() => handleBlockType(opt.type, opt.headingLevel ? { headingLevel: opt.headingLevel } : undefined)}
            >
              <span className={opt.className}>{opt.label}</span>
              {opt.shortcut && (
                <span className="ml-4 text-[11px] text-muted-foreground">{modKey}+{opt.shortcut}</span>
              )}
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

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                aria-label="Highlight color"
              >
                <IconHighlight size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Highlight color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-auto p-2">
          <button
            className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            onClick={() => handleHighlightColor("")}
          >
            <IconDropletOff size={14} />
            Reset
          </button>
          <div className="grid grid-cols-5 gap-1">
            {BG_COLORS.map((color) => (
              <button
                key={color}
                className="h-5 w-5 cursor-pointer rounded border border-border hover:scale-125 transition-transform"
                style={{ backgroundColor: color }}
                onClick={() => handleHighlightColor(color)}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleInsertLink}
            aria-label="Insert link"
          >
            <IconLink size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Insert link ({modKey}+K)</TooltipContent>
      </Tooltip>

      <TableDropdown editor={editor} />

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
        <DropdownMenuContent className="w-[200px]">
          <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("left")}>
            <span className="flex items-center"><IconAlignLeft size={16} className="mr-2" />Left</span>
            <span className="text-[11px] text-muted-foreground">{modKey}+⇧L</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("center")}>
            <span className="flex items-center"><IconAlignCenter size={16} className="mr-2" />Center</span>
            <span className="text-[11px] text-muted-foreground">{modKey}+⇧E</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("right")}>
            <span className="flex items-center"><IconAlignRight size={16} className="mr-2" />Right</span>
            <span className="text-[11px] text-muted-foreground">{modKey}+⇧R</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="flex items-center justify-between" onClick={() => handleAlign("justify")}>
            <span className="flex items-center"><IconAlignJustified size={16} className="mr-2" />Justify</span>
            <span className="text-[11px] text-muted-foreground">{modKey}+⇧J</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
        <TooltipContent>Numbered list ({modKey}+⇧7)</TooltipContent>
      </Tooltip>

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
        <TooltipContent>Bulleted list ({modKey}+⇧8)</TooltipContent>
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
        <TooltipContent>Decrease indent ({modKey}+[)</TooltipContent>
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
        <TooltipContent>Increase indent ({modKey}+])</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* ── Export DOCX ── */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:opacity-50"
            onClick={handleExportDocx}
            disabled={!editor || exporting}
            aria-label="Export as DOCX"
          >
            <IconFileDownload size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Export as DOCX</TooltipContent>
      </Tooltip>

    </div>
  );
}
