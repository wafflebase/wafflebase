import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconDotsVertical } from "@tabler/icons-react";
import { ToolbarButton } from "@/components/ui/toolbar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { computeFoldIndex, isHiddenInMenu } from "./toolbar-overflow-layout";

/** Marks the More button while nothing is folded (it is hidden then). */
const MORE_IDLE_ATTR = "data-toolbar-more-idle";

/** Marks a direct child of a strip (or of the More popover) as not shown there. */
const FOLDED_ATTR = "data-toolbar-folded";

function isSeparator(el: Element): boolean {
  return el.getAttribute("data-slot") === "separator";
}

function setFolded(el: Element, folded: boolean) {
  if (folded) el.setAttribute(FOLDED_ATTR, "");
  else el.removeAttribute(FOLDED_ATTR);
}

export interface ToolbarOverflowProps {
  /** The contextual controls; their top-level DOM children are what folds. */
  children: ReactNode;
  /**
   * Closes the menu when the toolbar morphs (idle / object / text-edit):
   * a menu left open would suddenly hold a different set of controls.
   */
  resetKey: string;
  /**
   * A text box is being edited. The More trigger and menu then carry
   * `data-text-edit-keepalive`, so opening the menu does not blur-commit
   * the edit the folded controls are about to format (see
   * `components/toolbar-focus-release.ts`).
   */
  keepTextEdit?: boolean;
}

/**
 * The toolbar's contextual middle, folding whatever does not fit into a
 * "More" (⋮) menu — Google Slides' narrow-window behaviour, and the same
 * ⋮ `ToolbarButton` the Docs and Sheets toolbars use for their "More
 * formatting options" menus.
 *
 * Docs and Sheets fold a fixed set of controls behind a viewport
 * breakpoint, into menu items. That does not carry over: the slides
 * middle morphs between three states whose widths differ by ~500px, the
 * sidebar takes a varying share of the window, and the controls here
 * are pickers and toggles rather than menu actions. So the fold point is
 * measured, from the tail, and the menu is a popover that renders the
 * same section a second time with the controls still shown in the strip
 * hidden — the folded ones keep their own pickers, state and shortcuts
 * instead of being re-implemented as menu items.
 *
 * Folding is written to the DOM (`data-toolbar-folded` on the strip's
 * top-level children) inside the measuring pass, so the strip never
 * paints a frame with controls past its edge. jsdom has no layout, so
 * nothing ever folds there.
 */
export function ToolbarOverflow({
  children,
  resetKey,
  keepTextEdit = false,
}: ToolbarOverflowProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [foldAt, setFoldAt] = useState<number | null>(null);
  const [separators, setSeparators] = useState<boolean[]>([]);
  const [open, setOpen] = useState(false);
  // Whether the menu was opened by a pointer, whose focus stays on the
  // trigger; a keyboard open moves focus into the menu.
  const pointerOpenRef = useRef(false);

  const measure = useCallback(() => {
    const strip = stripRef.current;
    const more = moreRef.current;
    if (!strip || !more) return;
    const kids = Array.from(strip.children);
    kids.forEach((el) => setFolded(el, false));
    // Measure with More shown, so `clientWidth` is the room left for the
    // strip if anything has to fold.
    more.removeAttribute(MORE_IDLE_ATTR);
    const gap = parseFloat(getComputedStyle(strip.parentElement ?? strip).columnGap) || 0;
    const moreWidth = more.offsetWidth + gap;
    const items = kids.map((el) => ({
      right:
        el instanceof HTMLElement ? el.offsetLeft + el.offsetWidth : 0,
      separator: isSeparator(el),
    }));
    const next = computeFoldIndex(items, strip.clientWidth, moreWidth);
    // The fold markers and More's visibility are one synchronous DOM
    // write, so no frame shows controls folded away without a way to
    // reach them. React state below only feeds the popover, which opens
    // on a click — long after React has caught up.
    if (next === null) more.setAttribute(MORE_IDLE_ATTR, "");
    else kids.forEach((el, i) => setFolded(el, i >= next));
    const seps = items.map((item) => item.separator);
    setFoldAt(next);
    setSeparators((prev) =>
      prev.length === seps.length && prev.every((s, i) => s === seps[i])
        ? prev
        : seps,
    );
  }, []);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    // The strip's own box shrinks and grows with the toolbar row; the row
    // is what resizes with the window and the sidebar — including when
    // the pinned right strip's labels appear or disappear.
    const row = strip?.parentElement;
    if (!strip || !row) return;
    measure();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(row);
    // Children swap on every selection change, and labels (font name,
    // zoom percentage) change width without the row resizing. Attribute
    // changes are not observed — the fold markers are attributes.
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(measure);
    mutation?.observe(row, { childList: true, subtree: true, characterData: true });
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [measure]);

  useEffect(() => setOpen(false), [resetKey]);
  useEffect(() => {
    if (foldAt === null) setOpen(false);
  }, [foldAt]);

  const keepalive = keepTextEdit ? { "data-text-edit-keepalive": "" } : {};

  return (
    <>
      <div
        ref={stripRef}
        data-testid="toolbar-contextual"
        // `!shrink` against the row's `[&>*]:shrink-0` (see ./index.tsx):
        // the strip is the one item that gives up room, so `clientWidth`
        // is exactly what is left once everything else is laid out.
        className="relative flex min-w-0 !shrink items-center gap-0.5 [&>*]:shrink-0 [&>[data-toolbar-folded]]:!hidden"
      >
        {children}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <ToolbarButton
                ref={moreRef}
                aria-label="More toolbar options"
                // Visibility is written by `measure()`, never by React: a
                // className keyed on `foldAt` would lag the fold markers.
                className="shrink-0 data-[toolbar-more-idle]:!hidden"
                onPointerDown={() => (pointerOpenRef.current = true)}
                onKeyDown={() => (pointerOpenRef.current = false)}
                {...keepalive}
              >
                <IconDotsVertical size={16} />
              </ToolbarButton>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        {foldAt !== null && (
          <PopoverContent
            align="end"
            // The canvas-toolbar marker lets a click in here hand the
            // keyboard back to the canvas like the strip does (#882); the
            // keepalive marker, when set, outranks it during a text edit.
            data-canvas-toolbar=""
            {...keepalive}
            onOpenAutoFocus={(e) => {
              // A click leaves focus on the trigger, as the strip's own
              // pickers do — moving it into the menu would only have the
              // canvas focus release take it away again. A keyboard open
              // lands on the first folded control.
              if (pointerOpenRef.current) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              // A folded picker's own menu is portalled outside this
              // popover; clicking in it must not close the host.
              const target = e.target as Element | null;
              if (target?.closest?.("[data-radix-popper-content-wrapper]")) {
                e.preventDefault();
              }
            }}
            className="flex w-auto max-w-[min(480px,calc(100vw-32px))] flex-wrap items-center gap-0.5 p-1 pointer-coarse:gap-1 pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:shrink-0 pointer-coarse:[&_button:not([class*='min-w-['])]:min-w-11"
          >
            <FoldedCopy foldAt={foldAt} separators={separators}>
              {children}
            </FoldedCopy>
          </PopoverContent>
        )}
      </Popover>
    </>
  );
}

/**
 * The second rendering of the section inside the More menu, showing only
 * the controls folded out of the strip. Same component, same props, so
 * its top-level children line up index for index with the strip's.
 */
function FoldedCopy({
  foldAt,
  separators,
  children,
}: {
  foldAt: number;
  separators: readonly boolean[];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () =>
      Array.from(el.children).forEach((child, i) =>
        setFolded(child, isHiddenInMenu(separators, foldAt, i)),
      );
    apply();
    const mutation =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(apply);
    mutation?.observe(el, { childList: true });
    return () => mutation?.disconnect();
  }, [foldAt, separators]);
  return (
    <div
      ref={ref}
      data-testid="toolbar-overflow-menu"
      className="contents [&>[data-toolbar-folded]]:!hidden"
    >
      {children}
    </div>
  );
}
