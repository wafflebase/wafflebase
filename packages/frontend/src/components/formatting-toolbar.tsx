import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Spreadsheet,
  BorderPreset,
  CellStyle,
  VerticalAlign,
  NumberFormatPreset,
  NumberFormatPresetId,
} from "@wafflebase/sheets";
import {
  activeNumberFormatPreset,
  buildNumberFormatPresets,
} from "@wafflebase/sheets";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar, ToolbarSeparator, ToolbarButton } from "@/components/ui/toolbar";
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
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BG_COLORS, TEXT_COLORS } from "@/components/formatting-colors";
import { ColorPickerGrid } from "@/components/color-picker-grid";
import { ColorSwatchButton } from "@/components/color-swatch-button";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignBoxTopCenter,
  IconAlignBoxCenterMiddle,
  IconAlignBoxBottomCenter,
  IconTypography,
  IconDropletHalf2Filled,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCurrency,
  IconCurrencyDollar,
  IconCurrencyDollarAustralian,
  IconCurrencyDollarCanadian,
  IconCurrencyDollarSingapore,
  IconCurrencyEuro,
  IconCurrencyPound,
  IconCurrencyYen,
  IconCurrencyYuan,
  IconCurrencyWon,
  IconCurrencyRupee,
  IconCurrencyReal,
  IconCurrencyRubel,
  IconCurrencyLira,
  IconCurrencyShekel,
  IconCurrencyFrank,
  IconCurrencyZloty,
  IconCurrencyBaht,
  IconCurrencyDong,
  IconCurrencyNaira,
  IconCurrencyHryvnia,
  IconCurrencyPeso,
  IconPercentage,
  IconDecimal,
  IconChevronDown,
  IconHash,
  IconAbc,
  IconCalendar,
  IconNumber123,
  IconUnderline,
  IconTableAlias,
  IconFilter,
  IconMathFunction,
  IconChartBar,
  IconBorderAll,
  IconBorderOuter,
  IconBorderInner,
  IconBorderTop,
  IconBorderBottom,
  IconBorderLeft,
  IconBorderRight,
  IconBorderNone,
  IconDotsVertical,
  IconPaint,
  IconPalette,
  IconPhoto,
  IconListCheck,
} from "@tabler/icons-react";

const ALIGN_ICONS = {
  left: IconAlignLeft,
  center: IconAlignCenter,
  right: IconAlignRight,
} as const;

const VALIGN_ICONS = {
  top: IconAlignBoxTopCenter,
  middle: IconAlignBoxCenterMiddle,
  bottom: IconAlignBoxBottomCenter,
} as const;

/**
 * The currency button draws the symbol of the currency it applies, so a
 * button that writes ₩ never shows a $. Currencies without a drawn symbol in
 * the icon set fall back to the generic currency sign (¤).
 */
const CURRENCY_ICONS: Record<string, typeof IconCurrency> = {
  USD: IconCurrencyDollar,
  HKD: IconCurrencyDollar,
  NZD: IconCurrencyDollar,
  TWD: IconCurrencyDollar,
  AUD: IconCurrencyDollarAustralian,
  CAD: IconCurrencyDollarCanadian,
  SGD: IconCurrencyDollarSingapore,
  EUR: IconCurrencyEuro,
  GBP: IconCurrencyPound,
  JPY: IconCurrencyYen,
  CNY: IconCurrencyYuan,
  KRW: IconCurrencyWon,
  INR: IconCurrencyRupee,
  PKR: IconCurrencyRupee,
  BRL: IconCurrencyReal,
  RUB: IconCurrencyRubel,
  TRY: IconCurrencyLira,
  ILS: IconCurrencyShekel,
  CHF: IconCurrencyFrank,
  PLN: IconCurrencyZloty,
  THB: IconCurrencyBaht,
  VND: IconCurrencyDong,
  NGN: IconCurrencyNaira,
  UAH: IconCurrencyHryvnia,
  MXN: IconCurrencyPeso,
  ARS: IconCurrencyPeso,
  CLP: IconCurrencyPeso,
  COP: IconCurrencyPeso,
  PHP: IconCurrencyPeso,
};

function currencyIcon(code: string | undefined) {
  return (code && CURRENCY_ICONS[code]) || IconCurrency;
}

/** "More formats" groups, separated the way Google Sheets separates them. */
const FORMAT_GROUPS: NumberFormatPresetId[][] = [
  ["plain", "number", "percent", "scientific"],
  ["accounting", "financial", "currency", "currencyRounded", "currencyUSD"],
  ["date", "time", "datetime"],
];

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

interface FormattingToolbarProps {
  spreadsheet: Spreadsheet | undefined;
  onInsertChart?: () => void;
  onOpenDataValidation?: () => void;
  onInsertImage?: (file: File) => void;
  onOpenConditionalFormat?: () => void;
  onTogglePaintFormat?: () => void;
  paintFormatActive?: boolean;
  isPivotTab?: boolean;
}

/**
 * Renders the FormattingToolbar component.
 */
export function FormattingToolbar({
  spreadsheet,
  onInsertChart,
  onOpenDataValidation,
  onInsertImage,
  onOpenConditionalFormat,
  onTogglePaintFormat,
  paintFormatActive = false,
  isPivotTab = false,
}: FormattingToolbarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [style, setStyle] = useState<CellStyle | undefined>(undefined);
  const [effectiveAlign, setEffectiveAlign] = useState<"left" | "center" | "right">("left");
  const [selectionMerged, setSelectionMerged] = useState(false);
  const [canMerge, setCanMerge] = useState(false);
  const [hasFilter, setHasFilter] = useState(false);
  const [dataValidationActive, setDataValidationActive] = useState(false);
  // Controlled open state for color palettes — the swatches are plain
  // <button>s (not DropdownMenuItem), so Radix can't auto-close them.
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [bgColorOpen, setBgColorOpen] = useState(false);
  const presets: NumberFormatPreset[] = useMemo(
    () => buildNumberFormatPresets(),
    [],
  );
  const presetById = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
  );
  const activePreset = activeNumberFormatPreset(style, presets);
  const localCurrency = presetById.get("currency")?.style.cu;
  const CurrencyIcon = currencyIcon(localCurrency);
  const currencyLabel = `Format as currency (${localCurrency})`;

  const refreshStyle = useCallback(async () => {
    if (!spreadsheet) return;
    const [s, align] = await Promise.all([
      spreadsheet.getActiveStyle(),
      spreadsheet.getActiveEffectiveAlign(),
    ]);
    setStyle(s);
    setEffectiveAlign(align);
    setSelectionMerged(spreadsheet.isSelectionMerged());
    setCanMerge(spreadsheet.canMergeSelection());
    setHasFilter(spreadsheet.hasFilter());
    setDataValidationActive(
      spreadsheet.isCheckboxActive() || spreadsheet.isListActive(),
    );
  }, [spreadsheet]);

  useEffect(() => {
    if (!spreadsheet) return;
    refreshStyle();
    return spreadsheet.onSelectionChange(refreshStyle);
  }, [spreadsheet, refreshStyle]);

  const handleToggle = useCallback(
    (prop: "b" | "i" | "u" | "st") => {
      spreadsheet?.toggleStyle(prop);
    },
    [spreadsheet],
  );

  const handleAlign = useCallback(
    (align: "left" | "center" | "right") => {
      spreadsheet?.applyStyle({ al: align });
    },
    [spreadsheet],
  );

  const handleVerticalAlign = useCallback(
    (va: VerticalAlign) => {
      spreadsheet?.applyStyle({ va });
    },
    [spreadsheet],
  );

  const handleTextColor = useCallback(
    (color: string) => {
      spreadsheet?.applyStyle({ tc: color });
      setTextColorOpen(false);
    },
    [spreadsheet],
  );

  const handleResetTextColor = useCallback(() => {
    spreadsheet?.applyStyle({ tc: "" });
    setTextColorOpen(false);
  }, [spreadsheet]);

  const handleBgColor = useCallback(
    (color: string) => {
      spreadsheet?.applyStyle({ bg: color });
      setBgColorOpen(false);
    },
    [spreadsheet],
  );

  const handleResetBgColor = useCallback(() => {
    spreadsheet?.applyStyle({ bg: "" });
    setBgColorOpen(false);
  }, [spreadsheet]);

  const handleUndo = useCallback(() => {
    spreadsheet?.undo();
  }, [spreadsheet]);

  const handleRedo = useCallback(() => {
    spreadsheet?.redo();
  }, [spreadsheet]);

  const handleToggleFunctionBrowser = useCallback(() => {
    spreadsheet?.toggleFunctionBrowser();
  }, [spreadsheet]);

  const handleInsertChart = useCallback(() => {
    onInsertChart?.();
  }, [onInsertChart]);

  const handleOpenConditionalFormat = useCallback(() => {
    onOpenConditionalFormat?.();
  }, [onOpenConditionalFormat]);

  const handleTogglePaintFormat = useCallback(() => {
    onTogglePaintFormat?.();
  }, [onTogglePaintFormat]);

  const handleNumberFormat = useCallback(
    (id: NumberFormatPresetId) => {
      const preset = presetById.get(id);
      if (preset) spreadsheet?.applyStyle({ ...preset.style });
    },
    [presetById, spreadsheet],
  );

  const handleIncreaseDecimals = useCallback(() => {
    spreadsheet?.increaseDecimals();
  }, [spreadsheet]);

  const handleDecreaseDecimals = useCallback(() => {
    spreadsheet?.decreaseDecimals();
  }, [spreadsheet]);

  const handleToggleMerge = useCallback(() => {
    spreadsheet?.toggleMergeCells();
  }, [spreadsheet]);

  const handleToggleFilter = useCallback(async () => {
    if (!spreadsheet) return;
    if (spreadsheet.hasFilter()) {
      await spreadsheet.clearFilter();
    } else {
      await spreadsheet.createFilterFromSelection();
    }
    await refreshStyle();
  }, [refreshStyle, spreadsheet]);

  const handleBorders = useCallback(
    (preset: BorderPreset) => {
      spreadsheet?.applyBorders(preset);
    },
    [spreadsheet],
  );

  const currentAlign = effectiveAlign;
  const CurrentAlignIcon = ALIGN_ICONS[currentAlign];
  const currentVAlign = style?.va || "top";
  const CurrentVAlignIcon = VALIGN_ICONS[currentVAlign];

  return (
    <Toolbar>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onInsertImage?.(file);
          e.target.value = "";
        }}
      />
      {/* Undo / Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton onClick={handleUndo} aria-label="Undo">
            <IconArrowBackUp size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>Undo ({modKey}+Z)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton onClick={handleRedo} aria-label="Redo">
            <IconArrowForwardUp size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>
          Redo ({modKey}+{isMac ? "⇧Z" : "Y"})
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton
            className={paintFormatActive ? "bg-muted" : ""}
            onClick={handleTogglePaintFormat}
            aria-label={paintFormatActive ? "Cancel paint format" : "Paint format"}
          >
            <IconPaint size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>
          {paintFormatActive ? "Cancel paint format" : "Paint format"}
        </TooltipContent>
      </Tooltip>

      <ToolbarSeparator />

      {!isMobile && (
        <>
          {/* Currency shortcut */}
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={() => handleNumberFormat("currency")}
                aria-label={currencyLabel}
              >
                <CurrencyIcon size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>{currencyLabel}</TooltipContent>
          </Tooltip>

          {/* Percent shortcut */}
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={() => handleNumberFormat("percent")}
                aria-label="Format as percent"
              >
                <IconPercentage size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Format as percent</TooltipContent>
          </Tooltip>

          {/* Decrease decimals */}
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={handleDecreaseDecimals}
                aria-label="Decrease decimal places"
              >
                <IconDecimal size={16} />
                <span className="absolute mt-3.5 ml-3 text-2xs font-bold leading-none">
                  -
                </span>
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Decrease decimal places</TooltipContent>
          </Tooltip>

          {/* Increase decimals */}
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={handleIncreaseDecimals}
                aria-label="Increase decimal places"
              >
                <IconDecimal size={16} />
                <span className="absolute mt-3.5 ml-3 text-2xs font-bold leading-none">
                  +
                </span>
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Increase decimal places</TooltipContent>
          </Tooltip>

          {/* More Format Dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton variant="menu" aria-label="More formats">
                    <IconNumber123 size={16} />
                    <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                  </ToolbarButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More formats</TooltipContent>
            </Tooltip>
            <DropdownMenuContent className="min-w-64">
              {FORMAT_GROUPS.map((group, index) => {
                const items = group.flatMap((id) => {
                  const preset = presetById.get(id);
                  return preset ? [preset] : [];
                });
                return (
                  <Fragment key={group[0]}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuGroup>
                      {items.map((preset) => (
                        <DropdownMenuCheckboxItem
                          key={preset.id}
                          checked={activePreset === preset.id}
                          onClick={() => handleNumberFormat(preset.id)}
                        >
                          {preset.label}
                          {preset.preview && (
                            <DropdownMenuShortcut className="tracking-normal tabular-nums">
                              {preset.preview}
                            </DropdownMenuShortcut>
                          )}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <ToolbarSeparator />
        </>
      )}

      {/* Text Style */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.b || false}
            onPressedChange={() => handleToggle("b")}
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
            pressed={style?.i || false}
            onPressedChange={() => handleToggle("i")}
            className="h-7 w-7 cursor-pointer"
            aria-label="Italic"
          >
            <IconItalic size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Italic ({modKey}+I)</TooltipContent>
      </Tooltip>

      {!isMobile && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={style?.u || false}
              onPressedChange={() => handleToggle("u")}
              className="h-7 w-7 cursor-pointer"
              aria-label="Underline"
            >
              <IconUnderline size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Underline ({modKey}+U)</TooltipContent>
        </Tooltip>
      )}

      {!isMobile && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={style?.st || false}
              onPressedChange={() => handleToggle("st")}
              className="h-7 w-7 cursor-pointer"
              aria-label="Strikethrough"
            >
              <IconStrikethrough size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Strikethrough ({modKey}+Shift+S)</TooltipContent>
        </Tooltip>
      )}

      {/* Text Color */}
      <Popover modal open={textColorOpen} onOpenChange={setTextColorOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <ColorSwatchButton
                icon={<IconTypography size={14} />}
                color={style?.tc || "var(--foreground)"}
                label="Text color"
              />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Text color</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-auto p-2">
          <ColorPickerGrid
            colors={TEXT_COLORS}
            colorKind="text color"
            onSelect={handleTextColor}
            onReset={handleResetTextColor}
          />
        </PopoverContent>
      </Popover>

      <ToolbarSeparator />

      {/* Background Color */}
      <Popover modal open={bgColorOpen} onOpenChange={setBgColorOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <ColorSwatchButton
                icon={<IconDropletHalf2Filled size={14} />}
                color={style?.bg || "var(--background)"}
                label="Fill color"
              />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Fill color</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-auto p-2">
          <ColorPickerGrid
            colors={BG_COLORS}
            colorKind="fill color"
            onSelect={handleBgColor}
            onReset={handleResetBgColor}
            noneLabel="None"
          />
        </PopoverContent>
      </Popover>

      {/* Borders */}
      {!isMobile && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ToolbarButton variant="menu" aria-label="Cell borders">
                  <IconBorderAll size={14} />
                  <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                </ToolbarButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Cell borders</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleBorders("all")}>
              <IconBorderAll size={14} className="mr-2" />
              All borders
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBorders("outer")}>
              <IconBorderOuter size={14} className="mr-2" />
              Outer border
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBorders("inner")}>
              <IconBorderInner size={14} className="mr-2" />
              Inner borders
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleBorders("top")}>
              <IconBorderTop size={14} className="mr-2" />
              Top border
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBorders("bottom")}>
              <IconBorderBottom size={14} className="mr-2" />
              Bottom border
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBorders("left")}>
              <IconBorderLeft size={14} className="mr-2" />
              Left border
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBorders("right")}>
              <IconBorderRight size={14} className="mr-2" />
              Right border
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleBorders("clear")}>
              <IconBorderNone size={14} className="mr-2" />
              Clear borders
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton
            className={selectionMerged ? "bg-muted" : ""}
            onClick={handleToggleMerge}
            disabled={isPivotTab || (!selectionMerged && !canMerge)}
            aria-label={selectionMerged ? "Unmerge cells" : "Merge cells"}
          >
            <IconTableAlias size={16} />
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>
          {selectionMerged
            ? "Unmerge cells"
            : `Merge cells (${modKey}+Shift+M)`}
        </TooltipContent>
      </Tooltip>

      {!isMobile && (
        <>
          <ToolbarSeparator />

          {/* Horizontal Alignment Dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton variant="menu" aria-label="Horizontal align">
                    <CurrentAlignIcon size={16} />
                    <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                  </ToolbarButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Horizontal align</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <DropdownMenuCheckboxItem
                checked={currentAlign === "left"}
                onClick={() => handleAlign("left")}
              >
                <IconAlignLeft size={16} className="mr-2" />
                Left
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={currentAlign === "center"}
                onClick={() => handleAlign("center")}
              >
                <IconAlignCenter size={16} className="mr-2" />
                Center
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={currentAlign === "right"}
                onClick={() => handleAlign("right")}
              >
                <IconAlignRight size={16} className="mr-2" />
                Right
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Vertical Alignment Dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton variant="menu" aria-label="Vertical align">
                    <CurrentVAlignIcon size={16} />
                    <IconChevronDown size={12} className="ml-0.5 opacity-50" />
                  </ToolbarButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Vertical align</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <DropdownMenuCheckboxItem
                checked={currentVAlign === "top"}
                onClick={() => handleVerticalAlign("top")}
              >
                <IconAlignBoxTopCenter size={16} className="mr-2" />
                Top
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={currentVAlign === "middle"}
                onClick={() => handleVerticalAlign("middle")}
              >
                <IconAlignBoxCenterMiddle size={16} className="mr-2" />
                Middle
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={currentVAlign === "bottom"}
                onClick={() => handleVerticalAlign("bottom")}
              >
                <IconAlignBoxBottomCenter size={16} className="mr-2" />
                Bottom
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToolbarSeparator />

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={handleToggleFunctionBrowser}
                aria-label="Functions"
              >
                <IconMathFunction size={16} className="mr-2" />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Functions</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                className={hasFilter ? "bg-muted" : ""}
                onClick={() => {
                  void handleToggleFilter();
                }}
                aria-label={hasFilter ? "Clear filter" : "Create filter"}
              >
                <IconFilter size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>
              {hasFilter ? "Clear filter" : "Create filter from selection"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={handleInsertChart}
                aria-label="Insert chart"
              >
                <IconChartBar size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Insert chart</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={() => imageInputRef.current?.click()}
                aria-label="Insert image"
              >
                <IconPhoto size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Insert image</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                className={dataValidationActive ? "bg-muted" : ""}
                onClick={onOpenDataValidation}
                aria-pressed={dataValidationActive}
                aria-label="Data validation"
              >
                <IconListCheck size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Data validation</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={handleOpenConditionalFormat}
                aria-label="Conditional formatting"
              >
                <IconPalette size={16} />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent>Conditional formatting</TooltipContent>
          </Tooltip>
        </>
      )}

      {isMobile && (
        <>
          <ToolbarSeparator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolbarButton aria-label="More formatting options">
                <IconDotsVertical size={16} />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Format</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleNumberFormat("currency")}>
                <CurrencyIcon size={16} className="mr-2" />
                {currencyLabel}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleNumberFormat("percent")}>
                <IconPercentage size={16} className="mr-2" />
                Percent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDecreaseDecimals}>
                <IconDecimal size={16} className="mr-2" />
                Decrease decimals
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleIncreaseDecimals}>
                <IconDecimal size={16} className="mr-2" />
                Increase decimals
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleNumberFormat("plain")}>
                <IconAbc size={16} className="mr-2" />
                Plain text
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleNumberFormat("number")}>
                <IconHash size={16} className="mr-2" />
                Number ({presetById.get("number")?.preview})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleNumberFormat("date")}>
                <IconCalendar size={16} className="mr-2" />
                Date ({presetById.get("date")?.preview})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void handleToggleFilter();
                }}
              >
                <IconFilter size={16} className="mr-2" />
                {hasFilter ? "Clear filter" : "Create filter"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Align</DropdownMenuLabel>
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
              <DropdownMenuItem onClick={() => handleVerticalAlign("top")}>
                <IconAlignBoxTopCenter size={16} className="mr-2" />
                Top
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleVerticalAlign("middle")}>
                <IconAlignBoxCenterMiddle size={16} className="mr-2" />
                Middle
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleVerticalAlign("bottom")}>
                <IconAlignBoxBottomCenter size={16} className="mr-2" />
                Bottom
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Borders</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleBorders("all")}>
                <IconBorderAll size={14} className="mr-2" />
                All borders
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("outer")}>
                <IconBorderOuter size={14} className="mr-2" />
                Outer border
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("inner")}>
                <IconBorderInner size={14} className="mr-2" />
                Inner borders
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("top")}>
                <IconBorderTop size={14} className="mr-2" />
                Top border
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("bottom")}>
                <IconBorderBottom size={14} className="mr-2" />
                Bottom border
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("left")}>
                <IconBorderLeft size={14} className="mr-2" />
                Left border
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("right")}>
                <IconBorderRight size={14} className="mr-2" />
                Right border
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBorders("clear")}>
                <IconBorderNone size={14} className="mr-2" />
                Clear borders
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleToggle("u")}>
                <IconUnderline size={16} className="mr-2" />
                Underline
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggle("st")}>
                <IconStrikethrough size={16} className="mr-2" />
                Strikethrough
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleFunctionBrowser}>
                <IconMathFunction size={16} className="mr-2" />
                Functions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleInsertChart}>
                <IconChartBar size={16} className="mr-2" />
                Insert chart
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <IconPhoto size={16} className="mr-2" />
                Insert image
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenDataValidation}>
                <IconListCheck size={16} className="mr-2" />
                Data validation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTogglePaintFormat}>
                <IconPaint size={16} className="mr-2" />
                {paintFormatActive ? "Cancel paint format" : "Paint format"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenConditionalFormat}>
                <IconPalette size={16} className="mr-2" />
                Conditional formatting
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </Toolbar>
  );
}
