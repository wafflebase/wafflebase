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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@tabler/icons-react";

const TEXT_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#cccccc",
  "#d50000", "#e67c73", "#f4511e", "#ef6c00", "#f09300",
  "#0b8043", "#33b679", "#039be5", "#3f51b5", "#7986cb",
  "#8e24aa", "#d81b60", "#ad1457", "#6a1b9a", "#4a148c",
];

const BG_COLORS = [
  "#ffffff", "#f3f3f3", "#e8e8e8", "#d9d9d9", "#cccccc",
  "#fce4ec", "#fff3e0", "#fff9c4", "#e8f5e9", "#e0f7fa",
  "#e3f2fd", "#ede7f6", "#fce4ec", "#f3e5f5", "#e8eaf6",
  "#ffcdd2", "#ffe0b2", "#fff59d", "#c8e6c9", "#b2dfdb",
];

interface FormattingToolbarProps {
  spreadsheet: Spreadsheet | undefined;
}

export function FormattingToolbar({ spreadsheet }: FormattingToolbarProps) {
  const [style, setStyle] = useState<CellStyle | undefined>(undefined);

  const refreshStyle = useCallback(async () => {
    if (!spreadsheet) return;
    const s = await spreadsheet.getActiveStyle();
    setStyle(s);
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
    [spreadsheet]
  );

  const handleAlign = useCallback(
    (align: "left" | "center" | "right") => {
      spreadsheet?.applyStyle({ al: align });
    },
    [spreadsheet]
  );

  const handleVerticalAlign = useCallback(
    (va: VerticalAlign) => {
      spreadsheet?.applyStyle({ va });
    },
    [spreadsheet]
  );

  const handleTextColor = useCallback(
    (color: string) => {
      spreadsheet?.applyStyle({ tc: color });
    },
    [spreadsheet]
  );

  const handleResetTextColor = useCallback(() => {
    spreadsheet?.applyStyle({ tc: "" });
  }, [spreadsheet]);

  const handleBgColor = useCallback(
    (color: string) => {
      spreadsheet?.applyStyle({ bg: color });
    },
    [spreadsheet]
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
    [spreadsheet]
  );

  return (
    <div className="flex items-center gap-0.5 border-b px-2 py-1 bg-background">
      {/* Undo / Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleUndo}
          >
            <IconArrowBackUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm hover:bg-muted"
            onClick={handleRedo}
          >
            <IconArrowForwardUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Number Format */}
      <Select
        value={style?.nf || "plain"}
        onValueChange={handleNumberFormat}
      >
        <SelectTrigger size="sm" className="w-[100px] h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="plain">Plain</SelectItem>
          <SelectItem value="number">Number</SelectItem>
          <SelectItem value="currency">Currency</SelectItem>
          <SelectItem value="percent">Percent</SelectItem>
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Text Style */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.b || false}
            onPressedChange={() => handleToggle("b")}
            className="h-7 w-7"
          >
            <IconBold size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Bold</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.i || false}
            onPressedChange={() => handleToggle("i")}
            className="h-7 w-7"
          >
            <IconItalic size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Italic</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.u || false}
            onPressedChange={() => handleToggle("u")}
            className="h-7 w-7"
          >
            <IconUnderline size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Underline</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.st || false}
            onPressedChange={() => handleToggle("st")}
            className="h-7 w-7"
          >
            <IconStrikethrough size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Strikethrough</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Text Color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm hover:bg-muted">
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

      {/* Background Color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm hover:bg-muted">
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

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Horizontal Alignment */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={!style?.al || style?.al === "left"}
            onPressedChange={() => handleAlign("left")}
            className="h-7 w-7"
          >
            <IconAlignLeft size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align left</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.al === "center"}
            onPressedChange={() => handleAlign("center")}
            className="h-7 w-7"
          >
            <IconAlignCenter size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align center</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.al === "right"}
            onPressedChange={() => handleAlign("right")}
            className="h-7 w-7"
          >
            <IconAlignRight size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align right</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Vertical Alignment */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={!style?.va || style?.va === "top"}
            onPressedChange={() => handleVerticalAlign("top")}
            className="h-7 w-7"
          >
            <IconAlignBoxTopCenter size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align top</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.va === "middle"}
            onPressedChange={() => handleVerticalAlign("middle")}
            className="h-7 w-7"
          >
            <IconAlignBoxCenterMiddle size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align middle</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={style?.va === "bottom"}
            onPressedChange={() => handleVerticalAlign("bottom")}
            className="h-7 w-7"
          >
            <IconAlignBoxBottomCenter size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align bottom</TooltipContent>
      </Tooltip>
    </div>
  );
}
