import { useState, useRef, useEffect, useCallback } from "react";
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
    stateRef.current = new FindReplaceState(editor.getDoc());
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
      state.search(q, { caseSensitive, useRegex });
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
    "flex items-center justify-center w-6 h-6 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40";
  const toggleBtnClass = (active: boolean) =>
    `flex items-center justify-center w-6 h-6 rounded ${
      active
        ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300"
        : "hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
    }`;

  return (
    <div
      className="absolute top-0 right-4 z-50 flex flex-col gap-1 rounded-b-lg border border-gray-300 bg-white p-2 shadow-md dark:border-gray-600 dark:bg-gray-800"
      style={{ minWidth: 320 }}
    >
      {/* Search row */}
      <div className="flex items-center gap-1">
        <input
          ref={searchInputRef}
          type="text"
          className="flex-1 rounded border border-gray-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:text-gray-100"
          placeholder="Find"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <span className="min-w-[60px] text-center text-xs text-gray-500 dark:text-gray-400">
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
            className="flex-1 rounded border border-gray-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:text-gray-100"
            placeholder="Replace"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
          />
          <button
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
            disabled={matchCount === 0}
            onClick={handleReplace}
          >
            Replace
          </button>
          <button
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
            disabled={matchCount === 0}
            onClick={handleReplaceAll}
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}
