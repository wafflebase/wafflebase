import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EditorAPI, SpellError } from "@wafflebase/docs";
import { IconLink, IconScissors, IconCopy, IconClipboard } from "@tabler/icons-react";
import { InsertCommentMenuItem } from "./comments/InsertCommentMenuItem";
import { modKey } from "@/components/text-formatting/platform";

interface Props {
  editor: EditorAPI | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  readOnly?: boolean;
  /** Called when the user picks "Add comment". Should run beginCompose. */
  onInsertComment: () => void;
}

interface MenuPosition {
  x: number;
  y: number;
}

type SuggestionsState =
  | { status: "loading" }
  | { status: "ready"; items: string[] };

interface OpenState {
  position: MenuPosition;
  spellErr: SpellError | undefined;
  hasSelection: boolean;
}

/**
 * Unified context menu for body (non-table) text: spell suggestions,
 * clipboard actions (cut/copy/paste), and insert actions (link + comment).
 *
 * In-table right-clicks are handled by DocsTableContextMenu and are
 * passed through here without interception (isInTable() guard).
 *
 * Plain positioned overlay — Radix ContextMenu blocks Canvas pointer
 * events, so we replicate the same pattern used by DocsTableContextMenu
 * and the former DocsCommentContextMenu.
 */
export function DocsContextMenu({
  editor,
  containerRef,
  readOnly = false,
  onInsertComment,
}: Props) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Monotonic generation counter: incremented each time the menu opens so
  // a stale async getSpellSuggestions result can be discarded.
  const genRef = useRef(0);

  const close = useCallback(() => {
    setOpen(null);
    setSuggestions(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!editor) return;
      if (editor.isInTable()) return;
      e.preventDefault();

      const spellErr = readOnly
        ? undefined
        : editor.getSpellErrorAt(e.clientX, e.clientY);
      const hasSelection = !!editor.getActiveSelection();

      setOpen({ position: { x: e.clientX, y: e.clientY }, spellErr, hasSelection });

      if (spellErr && !readOnly) {
        const gen = ++genRef.current;
        setSuggestions({ status: "loading" });
        editor.getSpellSuggestions(spellErr.word).then((items) => {
          if (genRef.current !== gen) return; // stale — menu reopened
          setSuggestions({ status: "ready", items });
        }).catch(() => {
          if (genRef.current !== gen) return;
          setSuggestions({ status: "ready", items: [] });
        });
      } else {
        setSuggestions(null);
      }
    },
    [editor, readOnly],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    return () => el.removeEventListener("contextmenu", handleContextMenu);
  }, [containerRef, handleContextMenu]);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  // Viewport clamp — offsetWidth/offsetHeight avoids the zoom-in
  // animation distorting getBoundingClientRect mid-animation.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const PAD = 8;
    let x = open.position.x;
    let y = open.position.y;
    if (x + width + PAD > vpW) x = Math.max(PAD, vpW - width - PAD);
    if (y + height + PAD > vpH) y = Math.max(PAD, vpH - height - PAD);
    if (x !== open.position.x || y !== open.position.y) {
      setOpen((prev) => prev ? { ...prev, position: { x, y } } : null);
    }
  }, [open, suggestions]);

  if (!open) return null;

  const { position, spellErr, hasSelection } = open;

  const item =
    "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground";
  const itemDisabled =
    "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none opacity-50 pointer-events-none";
  const sep = "my-1 h-px bg-border -mx-1";
  const shortcut = "ml-auto text-xs text-muted-foreground";
  const iconSize = 16;

  /** Wraps an action: runs it, focuses the editor, and closes the menu. */
  const act = (fn: () => void) => () => {
    fn();
    editor?.focus();
    close();
  };

  // ---- Group visibility ----
  const hasSpellGroup = !!spellErr;

  // Cut: needs selection + editable
  const showCut = hasSelection && !readOnly;
  // Copy: needs selection (allowed in readOnly)
  const showCopy = hasSelection;
  // Paste: editable only
  const showPaste = !readOnly;
  const hasClipboardGroup = showCut || showCopy || showPaste;

  // Insert actions — hidden in readOnly
  const hasInsertGroup = !readOnly;

  // Separators: only between groups that both exist
  const sepAfterSpell = hasSpellGroup && (hasClipboardGroup || hasInsertGroup);
  const sepAfterClipboard = hasClipboardGroup && hasInsertGroup;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
    >
      {/* ── Group 1: Spell suggestions ── */}
      {hasSpellGroup && (
        <>
          {suggestions === null || suggestions.status === "loading" ? (
            <span className={itemDisabled}>Checking…</span>
          ) : suggestions.items.length === 0 ? (
            <span className={itemDisabled}>No suggestions</span>
          ) : (
            suggestions.items.map((s) => (
              <button
                key={s}
                className={item}
                onClick={act(() => {
                  editor!.applySpellSuggestion(spellErr!, s);
                })}
              >
                {s}
              </button>
            ))
          )}
          {sepAfterSpell && <div className={sep} />}
        </>
      )}

      {/* ── Group 2: Clipboard ── */}
      {hasClipboardGroup && (
        <>
          {showCut && (
            <button
              className={item}
              onClick={act(() => editor!.cut())}
            >
              <IconScissors size={iconSize} className="text-muted-foreground" />
              Cut
              <span className={shortcut}>{modKey}X</span>
            </button>
          )}
          {showCopy && (
            <button
              className={item}
              onClick={act(() => editor!.copy())}
            >
              <IconCopy size={iconSize} className="text-muted-foreground" />
              Copy
              <span className={shortcut}>{modKey}C</span>
            </button>
          )}
          {showPaste && (
            <button
              className={item}
              onClick={act(() => {
                void editor!.paste();
              })}
            >
              <IconClipboard size={iconSize} className="text-muted-foreground" />
              Paste
              <span className={shortcut}>{modKey}V</span>
            </button>
          )}
          {sepAfterClipboard && <div className={sep} />}
        </>
      )}

      {/* ── Group 3: Insert ── */}
      {hasInsertGroup && (
        <>
          <button
            className={item}
            onClick={act(() => editor!.requestLink())}
          >
            <IconLink size={iconSize} className="text-muted-foreground" />
            Add link
            <span className={shortcut}>{modKey}K</span>
          </button>
          <InsertCommentMenuItem
            className={item}
            onSelect={() => {
              onInsertComment();
              editor?.focus();
              close();
            }}
          />
        </>
      )}
    </div>
  );
}
