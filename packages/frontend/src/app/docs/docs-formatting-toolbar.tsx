import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorAPI, EditContext } from "@wafflebase/docs";
import { DEFAULT_INLINE_STYLE } from "@wafflebase/docs";
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
import { ColorSwatchButton } from "@/components/color-swatch-button";
import { useMenuCloseHandlers } from "@/components/menu-focus";
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
  IconChevronDown,
  IconClearFormatting,
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
  FontFamilyPicker,
  FontSizePicker,
  LineSpacingPicker,
  InsertLinkButton,
  ensureFontLink,
} from "@/components/text-formatting";
import { STYLE_OPTIONS } from "@/components/text-formatting/text-style-options";
import { isMac, modKey } from "@/components/text-formatting/platform";

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
  // Controlled open state for the header/footer slim color palettes — the
  // swatches are plain <button>s, not DropdownMenuItem, so Radix can't
  // auto-close them.
  const [slimTextColorOpen, setSlimTextColorOpen] = useState(false);
  const [slimHighlightOpen, setSlimHighlightOpen] = useState(false);
  // Only refocus the editor when the palette was dismissed by a swatch
  // click. Outside-click / Esc fall through to Radix's default so we
  // don't yank focus from the user's actual click target.
  const slimTextColorMenu = useMenuCloseHandlers(() => editor?.focus());
  const slimHighlightMenu = useMenuCloseHandlers(() => editor?.focus());

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

  // ── Reactive selection summary ────────────────────────────────────────────
  // Drives the FontFamily / FontSize / LineSpacing pickers. Placed above the
  // header/footer early return so the slim toolbar (Task 12) can read the
  // same state. `editor.onCursorMove` is multi-listener and returns an
  // unsubscribe function — we MUST call it on cleanup so we do not leak
  // stale closures into the editor across remounts (and to keep parity
  // with the presence broadcaster registered in docs-view.tsx).
  type RangeSummary = ReturnType<NonNullable<typeof editor>["getRangeStyleSummary"]>;
  const [summary, setSummary] = useState<Partial<RangeSummary>>({});
  const [lineHeight, setLineHeight] = useState<number>(1.5);

  useEffect(() => {
    if (!editor) return;
    // The Google Fonts <link> is now injected by `useGoogleFontsLink()`
    // in `docs-view.tsx` so read-only viewers get the same web fonts;
    // the toolbar itself no longer needs to trigger it.
    const refresh = () => {
      setSummary(editor.getRangeStyleSummary());
      const bs = editor.getBlockStyle();
      setLineHeight(typeof bs.lineHeight === "number" ? bs.lineHeight : 1.5);
    };
    refresh();
    const unsubscribe = editor.onCursorMove(refresh);
    return unsubscribe;
  }, [editor]);

  // Distinguish "unset throughout the selection" (use the document default,
  // matching what the renderer paints) from "mixed values" (show empty in the
  // picker). Without this fallback a fresh document — whose only inline has
  // an empty `style: {}` — would render the family picker with an em-dash
  // and the size input empty, even though the renderer is laying out at the
  // default Arial 11.
  const familyValue =
    summary.fontFamily === "mixed"
      ? undefined
      : (summary.fontFamily ?? DEFAULT_INLINE_STYLE.fontFamily);
  const sizeValue =
    summary.fontSize === "mixed"
      ? undefined
      : (summary.fontSize ?? DEFAULT_INLINE_STYLE.fontSize);

  // DocStore does not currently expose a `fonts` registry, so the
  // ensureFont prefetch hook is best-effort: cast to read it without
  // adding a typing dependency on a yet-to-be-wired field.
  const ensureFont = (family: string) => {
    if (!editor) return;
    // Inject the per-family Google Fonts <link> first so the @font-face
    // exists before the registry's document.fonts.load(). No-ops for
    // curated/system families already covered by the bootstrap link.
    ensureFontLink(family);
    const store = editor.getStore() as unknown as {
      fonts?: { ensureFont?: (f: string) => void };
    };
    store.fonts?.ensureFont?.(family);
  };

  const handleFontFamily = (family: string) => {
    if (!editor) return;
    ensureFont(family);
    editor.applyStyle({ fontFamily: family });
    editor.focus();
  };
  const handleFontSize = (size: number) => {
    editor?.applyStyle({ fontSize: size });
    editor?.focus();
  };
  const handleLineSpacing = (lh: number) => {
    editor?.applyBlockStyle({ lineHeight: lh });
    editor?.focus();
  };
  const handleClearFormatting = () => {
    editor?.clearInlineFormatting();
    editor?.focus();
  };

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
      slimTextColorMenu.markSwatchClicked();
      setSlimTextColorOpen(false);
    };
    const handleHighlightColor = (backgroundColor: string) => {
      editor?.applyStyle({ backgroundColor });
      slimHighlightMenu.markSwatchClicked();
      setSlimHighlightOpen(false);
    };
    const handleAlign = (alignment: "left" | "center" | "right" | "justify") => {
      editor?.applyBlockStyle({ alignment });
      editor?.focus();
    };

    const slimSelectionStyle = editor?.getSelectionStyle();
    const slimAlignment = editor?.getBlockStyle()?.alignment ?? "left";
    const SlimAlignIcon =
      slimAlignment === "center"
        ? IconAlignCenter
        : slimAlignment === "right"
          ? IconAlignRight
          : slimAlignment === "justify"
            ? IconAlignJustified
            : IconAlignLeft;

    return (
      <Toolbar>
        <span className="mr-2 text-xs text-muted-foreground">{contextLabel}</span>

        <ToolbarSeparator />
        <FontFamilyPicker
          value={familyValue}
          onChange={handleFontFamily}
          onPrefetch={ensureFont}
        />
        <FontSizePicker value={sizeValue} onChange={handleFontSize} />
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

        <DropdownMenu open={slimTextColorOpen} onOpenChange={setSlimTextColorOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ColorSwatchButton
                  icon={<IconTypography size={14} />}
                  color={slimSelectionStyle?.color || "var(--wb-ink)"}
                  label="Text color"
                />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Text color</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            className="w-auto p-2"
            onCloseAutoFocus={slimTextColorMenu.onCloseAutoFocus}
          >
            <ColorPickerGrid colors={TEXT_COLORS} onSelect={handleTextColor} onReset={() => handleTextColor("")} />
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu open={slimHighlightOpen} onOpenChange={setSlimHighlightOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ColorSwatchButton
                  icon={<IconHighlight size={14} />}
                  color={slimSelectionStyle?.backgroundColor || "var(--wb-paper)"}
                  label="Highlight color"
                />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Highlight color</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            className="w-auto p-2"
            onCloseAutoFocus={slimHighlightMenu.onCloseAutoFocus}
          >
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
                  <SlimAlignIcon size={16} />
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
          <FontFamilyPicker
            value={familyValue}
            onChange={handleFontFamily}
            onPrefetch={ensureFont}
          />
          <FontSizePicker value={sizeValue} onChange={handleFontSize} />
          <ToolbarSeparator />
        </>
      )}

      {/* ── Text format (B/I/U, colors, clear) ── */}
      {/* Strikethrough hidden in the Docs toolbar — it lives on the shared
          component for the slides text-edit state, but the Docs toolbar
          keeps the primary inline-format row compact (B/I/U + colors).
          Link is hoisted out of the format group into the Insert cluster
          below so "insert something" actions (Link/Image/Table) sit
          together. */}
      <TextFormatGroup
        editor={editor}
        showStrikethrough={false}
        showLink={false}
        defaultTextColor="var(--wb-ink)"
        defaultHighlightColor="var(--wb-paper)"
      />

      {/* ── Insert / Block Styles / Export (desktop only) ── */}
      {!isMobile && (
        <>
          <ToolbarSeparator />

          <InsertLinkButton
            onClick={() => editor?.requestLink()}
            disabled={!editor}
          />

          <InsertImageDropdown editor={editor} />

          <TableDropdown editor={editor} />

          <ToolbarSeparator />

          {/* ── Paragraph styles (align, lists, indent) ── */}
          <TextParagraphGroup editor={editor} />

          <ToolbarSeparator />

          <LineSpacingPicker value={lineHeight} onChange={handleLineSpacing} />

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
              <DropdownMenuLabel>Font</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className="flex flex-col items-stretch gap-1 p-2"
              >
                <FontFamilyPicker
                  value={familyValue}
                  onChange={handleFontFamily}
                />
                <FontSizePicker value={sizeValue} onChange={handleFontSize} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Styles</DropdownMenuLabel>
              {STYLE_OPTIONS.map((opt) => (
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
              <DropdownMenuLabel>Spacing</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className="p-2"
              >
                <LineSpacingPicker
                  value={lineHeight}
                  onChange={handleLineSpacing}
                />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleClearFormatting}>
                <IconClearFormatting size={16} className="mr-2" />
                Clear formatting
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
