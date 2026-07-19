/**
 * Shared line-spacing dropdown. Stateless: the caller owns the current
 * value (a unitless multiplier of the run's font size) and reacts to
 * `onChange`. The picker offers four presets (1.0 / 1.15 / 1.5 / 2.0)
 * plus a "Custom…" inline numeric input that commits on submit or blur.
 * The accepted range is clamped to [LINE_SPACING_MIN, LINE_SPACING_MAX]
 * (0.5–10.0).
 */

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconLineHeight } from "@tabler/icons-react";
import {
  LINE_SPACING_PRESETS,
  LINE_SPACING_MIN,
  LINE_SPACING_MAX,
} from "./font-catalog";

interface LineSpacingPickerProps {
  /** Current line-height multiplier. */
  value: number;
  /** Called with the chosen multiplier (already clamped). */
  onChange: (lh: number) => void;
  disabled?: boolean;
}

/** "1.0", "1.15", "1.5", "2.0" — matches Google Docs' line-spacing labels. */
function formatPresetLabel(p: number): string {
  // Integers and integer-x.0 get one trailing zero ("1.0", "2.0").
  // Otherwise use the natural decimal representation ("1.15", "1.5").
  return Number.isInteger(p) ? `${p}.0` : String(p);
}

export function LineSpacingPicker({
  value,
  onChange,
  disabled,
}: LineSpacingPickerProps) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commitCustom = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(LINE_SPACING_MIN, Math.min(LINE_SPACING_MAX, n));
    onChange(clamped);
    setOpen(false);
    setCustomMode(false);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCustomMode(false);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Line spacing"
              disabled={disabled}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
            >
              <IconLineHeight size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Line spacing</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-[140px]">
        {customMode ? (
          <form
            className="flex items-center gap-1 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              commitCustom();
            }}
          >
            <input
              autoFocus
              type="number"
              aria-label="Custom line spacing"
              step={0.05}
              min={LINE_SPACING_MIN}
              max={LINE_SPACING_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitCustom}
              className="h-7 w-full rounded border border-border bg-background px-2 text-sm outline-none"
            />
          </form>
        ) : (
          <>
            {LINE_SPACING_PRESETS.map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                checked={value === p}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className="flex items-center justify-between"
              >
                <span>{formatPresetLabel(p)}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setCustomMode(true);
                setDraft(String(value));
              }}
            >
              Custom…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
