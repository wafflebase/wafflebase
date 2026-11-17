import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronDown, IconChevronUp, IconX } from "@tabler/icons-react";
import type { Element } from "@wafflebase/slides";
import type { Viewport } from "@wafflebase/board";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { findMatches, frameOnScreen, matchViewport } from "./board-find";
import { BOARD_OVERLAY_ATTR } from "./fit-insets";
import type { BoardNav } from "./board-nav";

export interface BoardFindBoxProps {
  nav: BoardNav;
  /** The board's top-level elements, read fresh on every search step. */
  readElements: () => readonly Element[];
  /**
   * Bumped by the host on every Mod+F, so a Find pressed while the box is
   * already open brings the keyboard back to the query.
   */
  focusRequest: number;
  onClose: () => void;
}

/** Outline colour of the current match: the app's ring (syrup). */
const HIGHLIGHT = "var(--ring, #c47f17)";

/**
 * Find on board (Mod+F). Board-local: it searches the text of stickies,
 * shapes and text boxes (`findMatches`), and Enter / Shift+Enter walk the
 * matches in reading order, moving the view onto each one through the
 * board's own viewport path and outlining it. It never touches the
 * selection or the document, so it works the same on a read-only board.
 */
export function BoardFindBox({ nav, readElements, focusRequest, onClose }: BoardFindBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [viewport, setViewport] = useState<Viewport>(() => nav.getViewport());

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusRequest]);

  // The outline follows the view: every pan / zoom / jump re-positions it.
  useEffect(() => nav.subscribe(setViewport), [nav]);

  const jumpTo = useCallback(
    (id: string) => {
      const el = readElements().find((e) => e.id === id);
      if (!el) return;
      const next = matchViewport(el.frame, nav.getHost(), nav.getViewport(), nav.getInsets());
      if (next) nav.commit(next);
    },
    [nav, readElements],
  );

  const search = (value: string) => {
    setQuery(value);
    const found = findMatches(readElements(), value);
    setMatches(found);
    setIndex(found.length > 0 ? 0 : -1);
    if (found.length > 0) jumpTo(found[0]);
  };

  const step = (direction: 1 | -1) => {
    // Re-read: a peer may have added, edited or deleted a match since the
    // last keystroke. Continue from the current match where it still is.
    const found = findMatches(readElements(), query);
    setMatches(found);
    if (found.length === 0) {
      setIndex(-1);
      return;
    }
    const currentId = matches[index];
    const at = currentId ? found.indexOf(currentId) : -1;
    const next =
      at === -1
        ? direction > 0
          ? 0
          : found.length - 1
        : (at + direction + found.length) % found.length;
    setIndex(next);
    jumpTo(found[next]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const currentEl = index >= 0 ? readElements().find((e) => e.id === matches[index]) : undefined;
  const outline = currentEl ? frameOnScreen(currentEl.frame, viewport) : null;

  return (
    <>
      {outline && (
        <div
          aria-hidden="true"
          data-testid="board-find-highlight"
          className="pointer-events-none absolute z-10 rounded-sm"
          style={{
            left: outline.x - 4,
            top: outline.y - 4,
            width: outline.w + 8,
            height: outline.h + 8,
            boxShadow: `0 0 0 3px ${HIGHLIGHT}`,
          }}
        />
      )}
      <div
        {...{ [BOARD_OVERLAY_ATTR]: "" }}
        role="search"
        className="absolute right-14 top-2 z-20 flex items-center gap-1 rounded-md border bg-background px-2 py-1 shadow-md"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="h-7 w-48 rounded border-none bg-transparent px-1 text-base md:text-sm outline-none focus:ring-0"
          placeholder="Find on board..."
          aria-label="Find on board"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
        <span
          className="min-w-[3.5rem] text-center text-xs text-muted-foreground"
          aria-live="polite"
        >
          {query.trim() ? `${matches.length > 0 ? index + 1 : 0}/${matches.length}` : ""}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="focus-ring rounded p-0.5 hover:bg-muted disabled:opacity-30"
              onClick={() => step(-1)}
              disabled={matches.length === 0}
              aria-label="Previous match"
            >
              <IconChevronUp size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Previous (Shift+Enter)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="focus-ring rounded p-0.5 hover:bg-muted disabled:opacity-30"
              onClick={() => step(1)}
              disabled={matches.length === 0}
              aria-label="Next match"
            >
              <IconChevronDown size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Next (Enter)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="focus-ring rounded p-0.5 hover:bg-muted"
              onClick={onClose}
              aria-label="Close find"
            >
              <IconX size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close (Esc)</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}
