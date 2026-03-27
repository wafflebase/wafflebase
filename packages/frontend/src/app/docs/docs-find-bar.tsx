import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { EditorAPI } from "@wafflebase/docs";
import { FindReplaceState } from "@wafflebase/docs";
import {
  IconChevronUp,
  IconChevronDown,
  IconX,
  IconLetterCase,
  IconRegex,
} from "@tabler/icons-react";

interface DocsFindBarProps {
  editor: EditorAPI | null;
  /** When true the replace row is visible. */
  showReplace: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * DOM overlay find (& replace) bar positioned at the top-right of
 * the document editor area.  Drives `FindReplaceState` against the
 * editor's Doc and pipes highlights through `editor.setSearchMatches()`.
 */
export function DocsFindBar({
  editor,
  showReplace,
  onClose,
  containerRef,
}: DocsFindBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);

  const stateRef = useRef<FindReplaceState | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Build / rebuild FindReplaceState when editor changes
  useEffect(() => {
    if (!editor) {
      stateRef.current = null;
      return;
    }
    stateRef.current = new FindReplaceState(
      editor.getDoc(),
      () => editor.getStore().snapshot(),
    );
  }, [editor]);

  // Focus the search input when the bar opens
  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [showReplace]);

  const syncHighlights = useCallback(() => {
    const state = stateRef.current;
    if (!editor || !state) return;
    editor.setSearchMatches(state.matches, state.activeIndex);
    setMatchCount(state.matches.length);
    setActiveIndex(state.activeIndex);
  }, [editor]);

  const runSearch = useCallback(
    (q: string) => {
      const state = stateRef.current;
      if (!state) return;
      try {
        state.search(q, { caseSensitive, useRegex });
      } catch {
        // Invalid regex pattern — clear results gracefully
        state.matches = [];
        state.activeIndex = -1;
      }
      syncHighlights();
    },
    [caseSensitive, useRegex, syncHighlights],
  );

  // Re-run search when options change
  useEffect(() => {
    if (query) runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSensitive, useRegex]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    runSearch(value);
  };

  const handleNext = () => {
    const state = stateRef.current;
    if (!state || state.matches.length === 0) return;
    state.next();
    syncHighlights();
  };

  const handlePrevious = () => {
    const state = stateRef.current;
    if (!state || state.matches.length === 0) return;
    state.previous();
    syncHighlights();
  };

  const handleReplace = () => {
    const state = stateRef.current;
    if (!state || state.activeIndex < 0) return;
    state.replaceActive(replacement);
    syncHighlights();
    editor?.render();
  };

  const handleReplaceAll = () => {
    const state = stateRef.current;
    if (!state || state.matches.length === 0) return;
    state.replaceAll(replacement);
    syncHighlights();
    editor?.render();
  };

  const handleClose = () => {
    editor?.clearSearchMatches(true);
    setQuery("");
    setReplacement("");
    onClose();
    editor?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleReplace();
    }
  };

  const counterText =
    matchCount > 0 ? `${activeIndex + 1} of ${matchCount}` : "No results";

  const iconBtnClass =
    "flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground disabled:opacity-40";
  const toggleBtnClass = (active: boolean) =>
    `flex items-center justify-center w-6 h-6 rounded ${
      active
        ? "bg-primary/10 text-primary"
        : "hover:bg-muted text-muted-foreground"
    }`;

  const containerRect = containerRef.current?.getBoundingClientRect();
  const fixedTop = containerRect?.top ?? 0;
  const fixedRight = containerRect
    ? window.innerWidth - containerRect.right + 16
    : 16;

  return createPortal(
    <div
      className="fixed z-50 flex flex-col gap-1 rounded-b-lg border bg-popover p-2 text-popover-foreground shadow-md"
      style={{ top: fixedTop, right: fixedRight, minWidth: 320 }}
    >
      {/* Search row */}
      <div className="flex items-center gap-1">
        <input
          ref={searchInputRef}
          type="text"
          className="flex-1 rounded border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          placeholder="Find"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <span className="min-w-[60px] text-center text-xs text-muted-foreground">
          {query ? counterText : ""}
        </span>
        <button
          className={toggleBtnClass(caseSensitive)}
          title="Match case"
          onClick={() => setCaseSensitive(!caseSensitive)}
        >
          <IconLetterCase size={14} />
        </button>
        <button
          className={toggleBtnClass(useRegex)}
          title="Use regex"
          onClick={() => setUseRegex(!useRegex)}
        >
          <IconRegex size={14} />
        </button>
        <button
          className={iconBtnClass}
          title="Previous (Shift+Enter)"
          disabled={matchCount === 0}
          onClick={handlePrevious}
        >
          <IconChevronUp size={14} />
        </button>
        <button
          className={iconBtnClass}
          title="Next (Enter)"
          disabled={matchCount === 0}
          onClick={handleNext}
        >
          <IconChevronDown size={14} />
        </button>
        <button className={iconBtnClass} title="Close (Esc)" onClick={handleClose}>
          <IconX size={14} />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            className="flex-1 rounded border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            placeholder="Replace"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
          />
          <button
            className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-40"
            disabled={matchCount === 0}
            onClick={handleReplace}
          >
            Replace
          </button>
          <button
            className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-40"
            disabled={matchCount === 0}
            onClick={handleReplaceAll}
          >
            All
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
