import {
  useCallback,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

/** The attribute every focusable message row carries, set to its id. */
export const ROW_ATTR = "data-message-row";

function rowIn(container: HTMLElement | null, id: string): HTMLElement | null {
  const escaped =
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  return (
    container?.querySelector<HTMLElement>(`[${ROW_ATTR}="${escaped}"]`) ?? null
  );
}

interface RovingOptions {
  /** Enter on a row: open its thread, say. */
  onActivate?: (id: string) => void;
  /** Escape on a row: hand focus back to the composer. */
  onEscape?: () => void;
}

/**
 * A message log as one tab stop, the way Slack's is: the rows form a roving
 * tabindex, so Tab crosses the log once on its way to the composer instead of
 * stepping through every message's hidden toolbar.
 *
 * The tab stop rests on the row last focused, or the newest one. ↑/↓ move a
 * message at a time, Home/End to either end; Enter activates the row and
 * Escape leaves for the composer. Keys pressed inside a row (on its links or
 * toolbar) are theirs, not the log's.
 *
 * Spread `onKeyDown` and `onFocus` on the element containing the rows, give
 * each row `ROW_ATTR` and a tabIndex of 0 only when it is `activeId`, and
 * keep every control inside a row at -1 unless the row is the active one.
 */
export function useRovingMessages(
  containerRef: RefObject<HTMLElement | null>,
  ids: string[],
  { onActivate, onEscape }: RovingOptions = {},
) {
  const [chosen, setChosen] = useState<string | null>(null);
  const activeId =
    chosen !== null && ids.includes(chosen) ? chosen : (ids.at(-1) ?? null);

  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(`[${ROW_ATTR}]`);
    const id = row?.getAttribute(ROW_ATTR);
    if (id) setChosen(id);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      const id = target.getAttribute(ROW_ATTR);
      if (!id || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const i = ids.indexOf(id);
      if (i < 0) return;
      let next: number | null = null;
      if (e.key === "ArrowUp") next = Math.max(0, i - 1);
      else if (e.key === "ArrowDown") next = Math.min(ids.length - 1, i + 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ids.length - 1;
      else if (e.key === "Enter" && onActivate) {
        e.preventDefault();
        onActivate(id);
        return;
      } else if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (next === null) return;
      e.preventDefault();
      const nextId = ids[next];
      setChosen(nextId);
      const row = rowIn(containerRef.current, nextId);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView?.({ block: "nearest" });
    },
    [ids, containerRef, onActivate, onEscape],
  );

  /** Focus a row by id (after an edit closes, say). */
  const focusRow = useCallback(
    (id: string) => {
      setChosen(id);
      rowIn(containerRef.current, id)?.focus({ preventScroll: true });
    },
    [containerRef],
  );

  return { activeId, onFocus, onKeyDown, focusRow };
}
