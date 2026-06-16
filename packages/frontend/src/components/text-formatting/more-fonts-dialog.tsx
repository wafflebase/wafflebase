/**
 * "More fonts…" dialog — search + category/script filters over the font
 * catalog, each row previewed in its own family.
 *
 * Preview loading is lazy: a single IntersectionObserver (rooted on the
 * scroll container) loads a row's Google Fonts `<link>` via
 * `ensureFontLink` only when it scrolls into view, so opening the dialog
 * does not fire ~90 font requests at once. DOM previews repaint
 * automatically once the face resolves. The technique scales to the
 * full library (P2) where windowing further trims the DOM.
 *
 * Picking a family calls `onPick` (which the caller wires to apply +
 * record as recent) and closes the dialog.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FONT_CATALOG, ensureFontLink, type FontEntry } from "./font-catalog";
import {
  filterFonts,
  type FontCategoryFilter,
  type FontScriptFilter,
} from "./more-fonts-filter";

const CATEGORIES: readonly FontCategoryFilter[] = [
  "All",
  "Korean",
  "Sans-serif",
  "Serif",
  "Monospace",
  "Display",
  "Handwriting",
];
const SCRIPTS: readonly FontScriptFilter[] = ["All", "Korean", "Latin"];

interface MoreFontsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently-applied family, highlighted in the list. */
  value: string | undefined;
  /** Called with the picked family; the dialog then closes. */
  onPick: (family: string) => void;
  /** Catalog to browse. Defaults to the curated catalog; P2 passes the
   *  full library. */
  catalog?: readonly FontEntry[];
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function MoreFontsDialog({
  open,
  onOpenChange,
  value,
  onPick,
  catalog = FONT_CATALOG,
}: MoreFontsDialogProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<FontCategoryFilter>("All");
  const [script, setScript] = useState<FontScriptFilter>("All");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Defer `onPick` to the dialog's close-autofocus, mirroring the
  // FontFamilyPicker dropdown: applying synchronously on click would let
  // Radix's focus-restore-on-close steal focus back from the editor that
  // the caller's onPick (…→ editor.focus()) just focused.
  const pendingPickRef = useRef<string | null>(null);

  // Debounce the free-text query so typing doesn't re-filter + re-observe
  // on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(
    () => filterFonts(catalog, { query: debounced, category, script }),
    [catalog, debounced, category, script],
  );

  // Lazy preview loading: observe every row and load its web font on
  // first scroll-into-view. Recreated whenever the dialog opens or the
  // result set changes (debounced, so cheap); the WeakMap of observed
  // nodes is implicit in the fresh DOM each render.
  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    if (typeof IntersectionObserver === "undefined" || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const family = (entry.target as HTMLElement).dataset.fontRow;
          if (family) ensureFontLink(family);
          obs.unobserve(entry.target);
        }
      },
      { root, rootMargin: "120px" },
    );
    root
      .querySelectorAll<HTMLElement>("[data-font-row]")
      .forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [open, results]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col gap-3"
        onCloseAutoFocus={(e) => {
          const family = pendingPickRef.current;
          if (family === null) return;
          e.preventDefault();
          pendingPickRef.current = null;
          onPick(family);
        }}
      >
        <DialogHeader>
          <DialogTitle>Fonts</DialogTitle>
          <DialogDescription className="sr-only">
            Search and browse fonts; select one to apply it to the current
            text.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search fonts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search fonts"
        />

        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {SCRIPTS.map((s) => (
            <Chip key={s} active={script === s} onClick={() => setScript(s)}>
              {s === "All" ? "All scripts" : s}
            </Chip>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-md border"
        >
          {results.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No fonts match.
            </p>
          ) : (
            <ul>
              {results.map((entry) => {
                const selected = entry.family === value;
                return (
                  // content-visibility lets the browser skip layout/paint
                  // for off-screen rows, so the full ~1,900-family list
                  // stays responsive without a windowing library. The
                  // intrinsic-size hint keeps the scrollbar accurate.
                  <li
                    key={entry.family}
                    style={{
                      contentVisibility: "auto",
                      containIntrinsicSize: "auto 40px",
                    }}
                  >
                    <button
                      type="button"
                      data-font-row={entry.family}
                      onClick={() => {
                        pendingPickRef.current = entry.family;
                        onOpenChange(false);
                      }}
                      className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-base hover:bg-muted ${
                        selected ? "bg-muted font-medium" : ""
                      }`}
                      style={{ fontFamily: entry.family }}
                    >
                      <span className="truncate">{entry.label}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {entry.group}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
