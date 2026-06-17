/**
 * Shared font-family dropdown. Stateless w.r.t. the applied value: the
 * caller owns `value` and reacts to `onChange`. Items are grouped by
 * `FontGroup` (Korean / Sans-serif / Serif / Monospace / Display /
 * Handwriting), preceded by a Recent section (localStorage-backed), and
 * followed by a "More fonts…" entry that opens the searchable
 * `MoreFontsDialog`. Each label previews in its own family. An undefined
 * `value` renders the em-dash placeholder used for mixed selections.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
import { MoreFontsDialog } from "./more-fonts-dialog";
import { getRecentFonts, addRecentFont } from "./font-recents";
import { loadFullFontCatalog } from "./font-catalog-full-loader";

const GROUP_ORDER: readonly FontGroup[] = [
  "Korean",
  "Sans-serif",
  "Serif",
  "Monospace",
  "Display",
  "Handwriting",
];

const CATALOG_BY_FAMILY: ReadonlyMap<string, FontEntry> = new Map(
  FONT_CATALOG.map((e) => [e.family, e]),
);

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

  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  // Full ~1,900-family library, lazy-loaded the first time the dialog
  // opens. Until it resolves the dialog browses the curated catalog
  // (its default), then swaps in the full list.
  const [fullCatalog, setFullCatalog] = useState<readonly FontEntry[] | null>(
    null,
  );

  useEffect(() => {
    if (!moreOpen || fullCatalog) return;
    let cancelled = false;
    loadFullFontCatalog()
      .then((c) => {
        if (!cancelled) setFullCatalog(c);
      })
      .catch(() => {
        /* keep the curated fallback on load failure */
      });
    return () => {
      cancelled = true;
    };
  }, [moreOpen, fullCatalog]);

  // Stash the picked family in a ref and replay it from `onCloseAutoFocus`
  // rather than firing `onChange` directly from the item's onClick. The
  // caller's onChange typically ends with `editor.focus()` to restore the
  // editor's hidden textarea — but Radix's FocusScope cleanup runs on a
  // `setTimeout(0)` after the click, so firing focus synchronously can
  // race the scope teardown and leave focus on the body. Mirrors the
  // proven `useMenuCloseHandlers` pattern used by the slim color
  // palettes. `pendingMoreRef` rides the same close-autofocus hop to open
  // the dialog only after the menu's focus scope has torn down.
  const pendingFamilyRef = useRef<string | null>(null);
  const pendingMoreRef = useRef(false);

  const applyPick = (family: string): void => {
    addRecentFont(family);
    onChange(family);
  };

  const label = value ?? "—";

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setRecents(getRecentFonts());
        }}
      >
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
            if (pendingMoreRef.current) {
              pendingMoreRef.current = false;
              e.preventDefault();
              setMoreOpen(true);
              return;
            }
            const family = pendingFamilyRef.current;
            if (family === null) {
              // No pick — let Radix restore focus to the trigger so Esc /
              // outside-click dismiss does not strand focus on <body>.
              return;
            }
            e.preventDefault();
            pendingFamilyRef.current = null;
            applyPick(family);
          }}
        >
          {recents.length > 0 && (
            <div>
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Recent
              </DropdownMenuLabel>
              {recents.map((family) => {
                const entry = CATALOG_BY_FAMILY.get(family);
                return (
                  <DropdownMenuItem
                    key={`recent:${family}`}
                    onPointerEnter={() => {
                      if (entry?.webFont ?? true) onPrefetch?.(family);
                    }}
                    onClick={() => {
                      pendingFamilyRef.current = family;
                    }}
                  >
                    <span style={{ fontFamily: family }}>
                      {entry?.label ?? family}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
          {GROUP_ORDER.map((group, gi) => {
            const entries = grouped.get(group) ?? [];
            if (entries.length === 0) return null;
            return (
              <div key={group}>
                {(recents.length > 0 || gi > 0) && <DropdownMenuSeparator />}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              pendingMoreRef.current = true;
            }}
          >
            More fonts…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MoreFontsDialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        value={value}
        onPick={applyPick}
        catalog={fullCatalog ?? undefined}
      />
    </>
  );
}
