import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronUp, IconChevronDown, IconX } from "@tabler/icons-react";
import type { Spreadsheet } from "@wafflebase/sheet";

interface FindBarProps {
  spreadsheet: Spreadsheet | undefined;
  onClose: () => void;
}

export function FindBar({ spreadsheet, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const updateSearchState = useCallback(() => {
    if (!spreadsheet) return;
    const state = spreadsheet.getSearchState();
    setTotal(state.total);
    setCurrentIndex(state.currentIndex);
  }, [spreadsheet]);

  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        if (!spreadsheet) return;
        void spreadsheet.find(value).then(() => {
          updateSearchState();
          refocusInput();
        });
      }, 150);
    },
    [spreadsheet, updateSearchState, refocusInput],
  );

  const handleNext = useCallback(() => {
    if (!spreadsheet) return;
    void spreadsheet.findNext().then(() => {
      updateSearchState();
      refocusInput();
    });
  }, [spreadsheet, updateSearchState, refocusInput]);

  const handlePrevious = useCallback(() => {
    if (!spreadsheet) return;
    void spreadsheet.findPrevious().then(() => {
      updateSearchState();
      refocusInput();
    });
  }, [spreadsheet, updateSearchState, refocusInput]);

  const handleClose = useCallback(() => {
    spreadsheet?.clearFind();
    onClose();
  }, [spreadsheet, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [handleClose, handleNext, handlePrevious],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const displayIndex = total > 0 ? currentIndex + 1 : 0;

  return (
    <div
      className="absolute right-4 top-2 z-20 flex items-center gap-1 rounded-md border bg-background px-2 py-1 shadow-md"
      onKeyDown={handleKeyDown}
    >
      <input
        ref={inputRef}
        type="text"
        className="h-7 w-48 rounded border-none bg-transparent px-1 text-sm outline-none focus:ring-0"
        placeholder="Find..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
      />
      <span className="min-w-[3.5rem] text-center text-xs text-muted-foreground">
        {query ? `${displayIndex}/${total}` : ""}
      </span>
      <button
        type="button"
        className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
        onClick={handlePrevious}
        disabled={total === 0}
        title="Previous (Shift+Enter)"
      >
        <IconChevronUp size={16} />
      </button>
      <button
        type="button"
        className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
        onClick={handleNext}
        disabled={total === 0}
        title="Next (Enter)"
      >
        <IconChevronDown size={16} />
      </button>
      <button
        type="button"
        className="rounded p-0.5 hover:bg-muted"
        onClick={handleClose}
        title="Close (Esc)"
      >
        <IconX size={16} />
      </button>
    </div>
  );
}
