import { useCallback, useRef, useState } from "react";
import type { EditorAPI, EditContext } from "@wafflebase/docs";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { TEXT_COLORS, BG_COLORS } from "@/components/formatting-colors";
import { ColorPickerGrid } from "@/components/color-picker-grid";
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
  IconArrowBackUp,
  IconArrowForwardUp,
  IconList,
  IconListNumbers,
  IconIndentDecrease,
  IconIndentIncrease,
  IconLink,
  IconTable,
  IconHash,
  IconFileDownload,
  IconPhoto,
  IconDotsVertical,
} from "@tabler/icons-react";
import { Toggle } from "@/components/ui/toggle";
import { TableGridPicker } from "./table-grid-picker";
import { exportDocxAndDownload } from "./docx-actions";
import { exportPdfAndDownload } from "./pdf-actions";
import { insertImageFromFile, insertImageFromUrl } from "./image-insert";
import { toast } from "sonner";
import {
  TextStyleGroup,
  TextFormatGroup,
  TextParagraphGroup,
} from "@/components/text-formatting";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

// ─── Docs-specific sub-components ────────────────────────────────────────────

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

function InsertImageDropdown({ editor }: { editor: EditorAPI | null }) {
  const [open, setOpen] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the dropdown's internal view back to the two-item menu. Used
  // by every code path that closes the dropdown — both the Radix
  // `onOpenChange` callback (user clicked outside / pressed Esc) and
  // our own programmatic closes (Upload / Insert submit). Setting the
  // controlled `open` prop to `false` does NOT re-fire `onOpenChange`,
  // so programmatic closes used to leave `urlMode === true` behind
  // and the dropdown reopened on the URL form next time.
  const closeAndReset = () => {
    setOpen(false);
    setUrlMode(false);
    setUrlInput("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      closeAndReset();
    } else {
      setOpen(true);
    }
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file twice still fires the
    // change event next time.
    e.target.value = "";
    if (!file || !editor) return;
    closeAndReset();
    await insertImageFromFile(editor, file);
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    const inserted = await insertImageFromUrl(editor, urlInput);
    // Only close the dropdown when the image was successfully
    // inserted. On validation / load failure the form stays open so
    // the user can correct the URL instead of retyping it.
    if (inserted) {
      closeAndReset();
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                aria-label="Insert image"
              >
                <IconPhoto size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Insert image</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-[220px]">
          {urlMode ? (
            <form className="flex flex-col gap-2 p-2" onSubmit={handleUrlSubmit}>
              <label className="text-xs text-muted-foreground" htmlFor="insert-image-url">
                Image URL
              </label>
              <input
                id="insert-image-url"
                type="url"
                autoFocus
                placeholder="https://…"
                value={urlInput}
                onChange={(ev) => setUrlInput(ev.target.value)}
                className="h-7 rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
              />
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  className="cursor-pointer rounded px-2 py-1 text-xs hover:bg-muted"
                  onClick={() => {
                    setUrlMode(false);
                    setUrlInput("");
                  }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="cursor-pointer rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                >
                  Insert
                </button>
              </div>
            </form>
          ) : (
            <>
              <DropdownMenuItem onClick={handlePickFile}>
                Upload from computer
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(ev) => {
                  // Keep the menu open so the URL input can render
                  // inside it. Without preventDefault, Radix closes
                  // the menu on `select`.
                  ev.preventDefault();
                  setUrlMode(true);
                }}
              >
                By URL…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DocsFormattingToolbarProps {
  editor: EditorAPI | null;
  editContext?: EditContext;
  documentTitle?: string;
}

export function DocsFormattingToolbar({ editor, editContext = 'body', documentTitle }: DocsFormattingToolbarProps) {
  const isMobile = useIsMobile();
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

  const handleExportPdf = useCallback(async () => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      const doc = editor.getStore().getDocument();
      await exportPdfAndDownload(doc, documentTitle ?? "document");
    } catch (err) {
      console.error("PDF export failed", err);
      toast.error(
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
      );
    } finally {
      setExporting(false);
    }
  }, [editor, documentTitle, exporting]);

  const handleUndo = useCallback(() => editor?.undo(), [editor]);
  const handleRedo = useCallback(() => editor?.redo(), [editor]);

  const handleInsertPageNumber = useCallback(() => {
    editor?.insertPageNumber();
    editor?.focus();
  }, [editor]);

  const isHeaderFooter = editContext === 'header' || editContext === 'footer';
  const contextLabel = editContext === 'header' ? 'Header' : 'Footer';

  // ── Header / Footer editing context ──────────────────────────────────────
  // A slimmed-down toolbar: B/I/U, colors, alignment, page number.
  // Does not use the shared formatting groups because the header/footer
  // surface is intentionally narrower (no lists, no link, no styles dropdown).
  if (isHeaderFooter) {
    const toggleBold = () => {
      if (!editor) return;
      const current = editor.getSelectionStyle();
      editor.applyStyle({ bold: !current.bold });
    };
    const toggleItalic = () => {
      if (!editor) return;
      const current = editor.getSelectionStyle();
      editor.applyStyle({ italic: !current.italic });
    };
    const toggleUnderline = () => {
      if (!editor) return;
      const current = editor.getSelectionStyle();
      editor.applyStyle({ underline: !current.underline });
    };
    const handleTextColor = (color: string) => {
      editor?.applyStyle({ color });
      editor?.focus();
    };
    const handleHighlightColor = (backgroundColor: string) => {
      editor?.applyStyle({ backgroundColor });
      editor?.focus();
    };
    const handleAlign = (alignment: "left" | "center" | "right" | "justify") => {
      editor?.applyBlockStyle({ alignment });
      editor?.focus();
    };

    return (
      <Toolbar>
        <span className="mr-2 text-xs text-muted-foreground">{contextLabel}</span>

        <ToolbarSeparator />

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
            <ColorPickerGrid colors={TEXT_COLORS} onSelect={handleTextColor} onReset={() => handleTextColor("")} />
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
            <ColorPickerGrid colors={BG_COLORS} onSelect={handleHighlightColor} onReset={() => handleHighlightColor("")} />
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarSeparator />

        {/* ── Alignment ── */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted" aria-label="Text alignment">
                  <IconAlignLeft size={16} />
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

        <ToolbarSeparator />

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
      </Toolbar>
    );
  }

  // ── Body editing context ──────────────────────────────────────────────────
  // Full toolbar — uses shared text-formatting components for the text
  // formatting controls; docs-specific items (table, image, export, overflow
  // mobile menu) remain inline.

  // The mobile overflow menu still needs to drive the same operations.
  // Define minimal local callbacks for the mobile menu only.
  const handleAlignMobile = (alignment: "left" | "center" | "right" | "justify") => {
    editor?.applyBlockStyle({ alignment });
    editor?.focus();
  };
  const handleBlockTypeMobile = (type: Parameters<EditorAPI["setBlockType"]>[0], opts?: Parameters<EditorAPI["setBlockType"]>[1]) => {
    editor?.setBlockType(type, opts);
    editor?.focus();
  };
  const handleInsertLinkMobile = () => {
    editor?.requestLink();
  };

  return (
    <Toolbar>
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

      <ToolbarSeparator />

      {/* ── Styles (desktop only) ── */}
      {!isMobile && (
        <>
          <TextStyleGroup editor={editor} />
          <ToolbarSeparator />
        </>
      )}

      {/* ── Text format (B/I/U, colors, link) ── */}
      <TextFormatGroup editor={editor} />

      {/* ── Insert / Block Styles / Export (desktop only) ── */}
      {!isMobile && (
        <>
          <ToolbarSeparator />

          <InsertImageDropdown editor={editor} />

          <TableDropdown editor={editor} />

          <ToolbarSeparator />

          {/* ── Paragraph styles (align, lists, indent) ── */}
          <TextParagraphGroup editor={editor} />

          <ToolbarSeparator />

          {/* ── Export ── */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:opacity-50"
                    disabled={!editor || exporting}
                    aria-label="Export"
                  >
                    <IconFileDownload size={16} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportDocx} disabled={!editor || exporting}>
                Word (.docx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf} disabled={!editor || exporting}>
                PDF (.pdf)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* ── Mobile overflow menu ── */}
      {isMobile && (
        <>
          <ToolbarSeparator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                aria-label="More formatting options"
              >
                <IconDotsVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Styles</DropdownMenuLabel>
              {[
                { label: "Normal text", type: "paragraph" as const, className: "text-[13px]" },
                { label: "Title", type: "title" as const, className: "text-[22px] leading-tight" },
                { label: "Subtitle", type: "subtitle" as const, className: "text-[13px] text-muted-foreground" },
                { label: "Heading 1", type: "heading" as const, headingLevel: 1 as const, className: "text-[18px] font-bold" },
                { label: "Heading 2", type: "heading" as const, headingLevel: 2 as const, className: "text-[16px] font-bold" },
                { label: "Heading 3", type: "heading" as const, headingLevel: 3 as const, className: "text-[14px] font-bold" },
              ].map((opt) => (
                <DropdownMenuItem
                  key={opt.label}
                  onClick={() =>
                    handleBlockTypeMobile(
                      opt.type,
                      "headingLevel" in opt ? { headingLevel: opt.headingLevel } : undefined,
                    )
                  }
                >
                  <span className={opt.className}>{opt.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Insert</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleInsertLinkMobile}>
                <IconLink size={16} className="mr-2" />
                Link
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file && editor) {
                      await insertImageFromFile(editor, file);
                    }
                  };
                  input.click();
                }}
              >
                <IconPhoto size={16} className="mr-2" />
                Image
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  editor?.insertTable(3, 3);
                  editor?.focus();
                }}
              >
                <IconTable size={16} className="mr-2" />
                Table (3×3)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Align</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleAlignMobile("left")}>
                <IconAlignLeft size={16} className="mr-2" />
                Left
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAlignMobile("center")}>
                <IconAlignCenter size={16} className="mr-2" />
                Center
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAlignMobile("right")}>
                <IconAlignRight size={16} className="mr-2" />
                Right
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAlignMobile("justify")}>
                <IconAlignJustified size={16} className="mr-2" />
                Justify
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>List</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { editor?.toggleList("ordered"); editor?.focus(); }}>
                <IconListNumbers size={16} className="mr-2" />
                Numbered list
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { editor?.toggleList("unordered"); editor?.focus(); }}>
                <IconList size={16} className="mr-2" />
                Bulleted list
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { editor?.outdent(); editor?.focus(); }}>
                <IconIndentDecrease size={16} className="mr-2" />
                Decrease indent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { editor?.indent(); editor?.focus(); }}>
                <IconIndentIncrease size={16} className="mr-2" />
                Increase indent
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Export</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExportDocx} disabled={!editor || exporting}>
                <IconFileDownload size={16} className="mr-2" />
                Word (.docx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf} disabled={!editor || exporting}>
                <IconFileDownload size={16} className="mr-2" />
                PDF (.pdf)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

    </Toolbar>
  );
}
