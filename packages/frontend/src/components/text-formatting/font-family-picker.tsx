/**
 * Shared font-family dropdown. Stateless: the caller owns the current
 * value and reacts to `onChange`. Items are grouped by `FontGroup`
 * (Korean / Sans-serif / Serif / Monospace) and each label previews in
 * its own family. An undefined `value` renders the em-dash placeholder
 * used for mixed selections.
 */

import { useMemo, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconChevronDown } from "@tabler/icons-react";
import { FONT_CATALOG, type FontEntry, type FontGroup } from "./font-catalog";

const GROUP_ORDER: readonly FontGroup[] = [
  "Korean",
  "Sans-serif",
  "Serif",
  "Monospace",
];

interface FontFamilyPickerProps {
  /** Current family, or undefined for the mixed/unset state. */
  value: string | undefined;
  /** Called with the selected family. */
  onChange: (family: string) => void;
  /** Prefetch hook fired on item pointer-enter (web fonts only). */
  onPrefetch?: (family: string) => void;
  disabled?: boolean;
}

export function FontFamilyPicker({
  value,
  onChange,
  onPrefetch,
  disabled,
}: FontFamilyPickerProps) {
  const grouped = useMemo(() => {
    const map = new Map<FontGroup, readonly FontEntry[]>();
    for (const group of GROUP_ORDER) {
      map.set(
        group,
        FONT_CATALOG.filter((f) => f.group === group),
      );
    }
    return map;
  }, []);

  // Stash the picked family in a ref and replay it from `onCloseAutoFocus`
  // rather than firing `onChange` directly from the item's onClick. The
  // caller's onChange typically ends with `editor.focus()` to restore the
  // editor's hidden textarea — but Radix's FocusScope cleanup runs on a
  // `setTimeout(0)` after the click, so firing focus synchronously can
  // race the scope teardown and leave focus on the body. Mirrors the
  // proven `useMenuCloseHandlers` pattern used by the slim color
  // palettes.
  const pendingFamilyRef = useRef<string | null>(null);

  const label = value ?? "—";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Font"
              disabled={disabled}
              className="inline-flex h-7 min-w-[112px] cursor-pointer items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              data-text-edit-keepalive
            >
              <span className="truncate" style={{ fontFamily: value }}>
                {label}
              </span>
              <IconChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Font</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="max-h-[320px] w-[220px] overflow-y-auto"
        data-text-edit-keepalive
        onCloseAutoFocus={(e) => {
          const family = pendingFamilyRef.current;
          if (family === null) {
            // No pick — let Radix restore focus to the trigger so Esc /
            // outside-click dismiss does not strand focus on <body>.
            return;
          }
          e.preventDefault();
          pendingFamilyRef.current = null;
          onChange(family);
        }}
      >
        {GROUP_ORDER.map((group, gi) => {
          const entries = grouped.get(group) ?? [];
          if (entries.length === 0) return null;
          return (
            <div key={group}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                {group}
              </DropdownMenuLabel>
              {entries.map((entry) => (
                <DropdownMenuItem
                  key={entry.family}
                  onPointerEnter={() => {
                    if (entry.webFont) onPrefetch?.(entry.family);
                  }}
                  onClick={() => {
                    pendingFamilyRef.current = entry.family;
                  }}
                >
                  <span style={{ fontFamily: entry.family }}>{entry.label}</span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
