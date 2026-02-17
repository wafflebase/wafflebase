import { useCallback, useEffect, useState } from "react";
import type {
  Spreadsheet,
  CellStyle,
  NumberFormat,
  VerticalAlign,
} from "@wafflebase/sheet";
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
  IconPaint,
  IconDropletOff,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCurrencyDollar,
  IconPercentage,
  IconDecimal,
  IconChevronDown,
  IconHash,
  IconAbc,
  IconTableAlias,
} from "@tabler/icons-react";

const TEXT_COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#cccccc",
  "#d50000",
  "#e67c73",
  "#f4511e",
  "#ef6c00",
  "#f09300",
  "#0b8043",
  "#33b679",
  "#039be5",
  "#3f51b5",
  "#7986cb",
  "#8e24aa",
  "#d81b60",
  "#ad1457",
  "#6a1b9a",
  "#4a148c",
];

const BG_COLORS = [
  "#ffffff",
  "#f3f3f3",
  "#e8e8e8",
  "#d9d9d9",
  "#cccccc",
  "#fce4ec",
  "#fff3e0",
  "#fff9c4",
  "#e8f5e9",
  "#e0f7fa",
  "#e3f2fd",
  "#ede7f6",
  "#fce4ec",
  "#f3e5f5",
  "#e8eaf6",
  "#ffcdd2",
  "#ffe0b2",
  "#fff59d",
  "#c8e6c9",
  "#b2dfdb",
];

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

const FORMAT_ICONS = {
  plain: IconAbc,
  number: IconHash,
  currency: IconCurrencyDollar,
  percent: IconPercentage,
} as const;

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

interface FormattingToolbarProps {
  spreadsheet: Spreadsheet | undefined;
}

export function FormattingToolbar({ spreadsheet }: FormattingToolbarProps) {
  const [style, setStyle] = useState<CellStyle | undefined>(undefined);
  const [selectionMerged, setSelectionMerged] = useState(false);
  const [canMerge, setCanMerge] = useState(false);

  const refreshStyle = useCallback(async () => {
    if (!spreadsheet) return;
    const s = await spreadsheet.getActiveStyle();
    setStyle(s);
    setSelectionMerged(spreadsheet.isSelectionMerged());
    setCanMerge(spreadsheet.canMergeSelection());
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
    },
    [spreadsheet],
  );

  const handleResetTextColor = useCallback(() => {
    spreadsheet?.applyStyle({ tc: "" });
  }, [spreadsheet]);

  const handleBgColor = useCallback(
    (color: string) => {
      spreadsheet?.applyStyle({ bg: color });
    },
    [spreadsheet],
  );

  const handleResetBgColor = useCallback(() => {
    spreadsheet?.applyStyle({ bg: "" });
  }, [spreadsheet]);

  const handleUndo = useCallback(() => {
    spreadsheet?.undo();
  }, [spreadsheet]);

  const handleRedo = useCallback(() => {
    spreadsheet?.redo();
  }, [spreadsheet]);

  const handleNumberFormat = useCallback(
    (format: string) => {
      spreadsheet?.applyStyle({ nf: format as NumberFormat });
    },
    [spreadsheet],
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

  const currentAlign = style?.al || "left";
  const CurrentAlignIcon = ALIGN_ICONS[currentAlign];
  const currentVAlign = style?.va || "top";
  const CurrentVAlignIcon = VALIGN_ICONS[currentVAlign];
  const currentFormat = (style?.nf || "plain") as keyof typeof FORMAT_ICONS;
  const CurrentFormatIcon = FORMAT_ICONS[currentFormat];

  return (
    <div className="flex items-center gap-0.5 border-b px-2 py-1 bg-background">
      {/* Undo / Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleUndo}
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
          >
            <IconArrowForwardUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Redo ({modKey}+{isMac ? "⇧Z" : "Y"})
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Currency shortcut */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={() => handleNumberFormat("currency")}
          >
            <IconCurrencyDollar size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Format as currency</TooltipContent>
      </Tooltip>

      {/* Percent shortcut */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={() => handleNumberFormat("percent")}
          >
            <IconPercentage size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Format as percent</TooltipContent>
      </Tooltip>

      {/* Decrease decimals */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleDecreaseDecimals}
          >
            <IconDecimal size={16} />
            <span className="absolute mt-3.5 ml-3 text-[8px] font-bold leading-none">
              -
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Decrease decimal places</TooltipContent>
      </Tooltip>

      {/* Increase decimals */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleIncreaseDecimals}
          >
            <IconDecimal size={16} />
            <span className="absolute mt-3.5 ml-3 text-[8px] font-bold leading-none">
              +
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Increase decimal places</TooltipContent>
      </Tooltip>

      {/* More Format Dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted">
                <CurrentFormatIcon size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More format</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => handleNumberFormat("plain")}>
            <IconAbc size={16} className="mr-2" />
            Plain text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleNumberFormat("number")}>
            <IconHash size={16} className="mr-2" />
            Number
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleNumberFormat("currency")}>
            <IconCurrencyDollar size={16} className="mr-2" />
            Currency
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleNumberFormat("percent")}>
            <IconPercentage size={16} className="mr-2" />
            Percent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Text Style */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.b || false}
            onPressedChange={() => handleToggle("b")}
            className="h-7 w-7 cursor-pointer"
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
            pressed={style?.st || false}
            onPressedChange={() => handleToggle("st")}
            className="h-7 w-7 cursor-pointer"
          >
            <IconStrikethrough size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Strikethrough</TooltipContent>
      </Tooltip>

      {/* Text Color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted">
                <IconTypography size={16} />
                <span
                  className="absolute mt-5 h-0.5 w-3.5 rounded"
                  style={{ backgroundColor: style?.tc || "#000000" }}
                />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-auto p-2">
          <button
            className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            onClick={handleResetTextColor}
          >
            <IconDropletOff size={14} />
            Reset
          </button>
          <div className="grid grid-cols-5 gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                className="h-5 w-5 rounded border border-border hover:scale-125 transition-transform"
                style={{ backgroundColor: color }}
                onClick={() => handleTextColor(color)}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Background Color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted">
                <IconPaint size={16} />
                <span
                  className="absolute mt-5 h-0.5 w-3.5 rounded"
                  style={{
                    backgroundColor: style?.bg || "transparent",
                    border: style?.bg ? "none" : "1px solid #ccc",
                  }}
                />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Fill color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-auto p-2">
          <button
            className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            onClick={handleResetBgColor}
          >
            <IconDropletOff size={14} />
            Reset
          </button>
          <div className="grid grid-cols-5 gap-1">
            {BG_COLORS.map((color) => (
              <button
                key={color}
                className="h-5 w-5 rounded border border-border hover:scale-125 transition-transform"
                style={{ backgroundColor: color }}
                onClick={() => handleBgColor(color)}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${
              selectionMerged ? "bg-muted" : ""
            }`}
            onClick={handleToggleMerge}
            disabled={!selectionMerged && !canMerge}
          >
            <IconTableAlias size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {selectionMerged
            ? "Unmerge cells"
            : `Merge cells (${modKey}+Shift+M)`}
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Horizontal Alignment Dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted">
                <CurrentAlignIcon size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Horizontal align</TooltipContent>
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

      {/* Vertical Alignment Dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted">
                <CurrentVAlignIcon size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Vertical align</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
