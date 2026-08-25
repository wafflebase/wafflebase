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
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconChevronDown } from "@tabler/icons-react";
import {
  FONT_CATALOG,
  ensurePreviewFontLink,
  type FontEntry,
  type FontGroup,
} from "./font-catalog";
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
  // Set once a full-catalog load has SETTLED, successfully or not. Distinct from
  // `fullCatalog` because a failed load must still unblock the recent rows below:
  // previewing at the default weights beats never previewing at all.
  const [fullSettled, setFullSettled] = useState(false);

  // A recent family can come from the full ~1,900-entry library, which the
  // curated catalog has no `weights` for — and a preview requested at the
  // default `400` renders in a fallback face for any family that ships no 400
  // cut (`css2?family=Sunflower:wght@400` answers HTTP 400). So pull the full
  // library whenever a recent is not in the curated index, not only when the
  // dialog opens. Same memoized import either way, so the second trigger costs
  // nothing once the first has run.
  const needFullForRecents = recents.some((f) => !CATALOG_BY_FAMILY.has(f));
  useEffect(() => {
    if (fullCatalog) return;
    if (!moreOpen && !(open && needFullForRecents)) return;
    let cancelled = false;
    loadFullFontCatalog()
      .then((c) => {
        if (!cancelled) setFullCatalog(c);
      })
      .catch(() => {
        /* keep the curated fallback on load failure */
      })
      .finally(() => {
        if (!cancelled) setFullSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [moreOpen, open, needFullForRecents, fullCatalog]);

  const fullByFamily = useMemo(
    () =>
      fullCatalog
        ? new Map(fullCatalog.map((e) => [e.family, e] as const))
        : null,
    [fullCatalog],
  );

  // Radix remounts the portalled content on every open, so the scroll
  // container has to reach the effect below through a callback ref into
  // state — a `useRef` would never re-run it.
  const [listEl, setListEl] = useState<HTMLElement | null>(null);

  // Load each row's face the first time it scrolls into view, so scroll and
  // keyboard navigation paint real previews instead of leaving everything
  // but the 8 `eager` families in a fallback (#727). Mirrors the observer
  // `MoreFontsDialog` runs over its own list. `recents` is a dep because
  // `onOpenChange` sets it, rendering the list a second time; `fullByFamily`
  // and `fullSettled` are deps because a recent row only grows its
  // `data-font-row` once its weights are resolvable (see the Recent section).
  useEffect(() => {
    if (!listEl || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const row = entry.target as HTMLElement;
          const family = row.dataset.fontRow;
          // Subset to the row's own text: a preview only ever paints the
          // label, so pulling the whole family is wasted bytes.
          if (family)
            ensurePreviewFontLink(
              family,
              row.textContent ?? "",
              row.dataset.fontWeights,
            );
          obs.unobserve(entry.target);
        }
      },
      // A few rows of lead; outrunning it only shows the `display=swap`
      // fallback until the face arrives.
      { root: listEl, rootMargin: "120px" },
    );
    listEl
      .querySelectorAll<HTMLElement>("[data-font-row]")
      .forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [listEl, recents, fullByFamily, fullSettled]);

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
          ref={setListEl}
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
                const entry =
                  CATALOG_BY_FAMILY.get(family) ?? fullByFamily?.get(family);
                // No `data-font-row` until the weights are known, so the
                // observer below cannot fire a `wght@400` request for a family
                // whose real cuts are still loading — it unobserves on first
                // hit and `ensurePreviewFontLink` is idempotent, so a wrong
                // first request is permanent. Once the load settles the effect
                // re-runs and the row is observed with its real weights (or,
                // if the load failed, with the defaults).
                const previewable = entry !== undefined || fullSettled;
                return (
                  <DropdownMenuCheckboxItem
                    key={`recent:${family}`}
                    data-font-row={previewable ? family : undefined}
                    data-font-weights={entry?.weights}
                    checked={family === value}
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
                  </DropdownMenuCheckboxItem>
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
                  <DropdownMenuCheckboxItem
                    key={entry.family}
                    data-font-row={entry.family}
                    data-font-weights={entry.weights}
                    checked={entry.family === value}
                    onPointerEnter={() => {
                      if (entry.webFont) onPrefetch?.(entry.family);
                    }}
                    onClick={() => {
                      pendingFamilyRef.current = entry.family;
                    }}
                  >
                    <span style={{ fontFamily: entry.family }}>{entry.label}</span>
                  </DropdownMenuCheckboxItem>
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
