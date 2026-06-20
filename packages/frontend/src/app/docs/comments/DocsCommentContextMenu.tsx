import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorAPI } from "@wafflebase/docs";

import { InsertCommentMenuItem } from "./InsertCommentMenuItem";

interface Props {
  editor: EditorAPI | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  readOnly?: boolean;
  /** Called when the user picks "Insert comment". Should run beginCompose. */
  onInsertComment: () => void;
}

interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Context menu offering "Insert comment" on a non-empty text selection.
 * Suppressed inside table cells — the table context menu handles those
 * — and in read-only mode.
 *
 * Plain positioned overlay rather than Radix, matching DocsTableContextMenu:
 * Radix blocks Canvas pointer events.
 */
export function DocsCommentContextMenu({
  editor,
  containerRef,
  readOnly = false,
  onInsertComment,
}: Props) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!editor || readOnly) return;
      if (editor.isInTable()) return;
      if (!editor.getActiveSelection()) return;
      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
    },
    [editor, readOnly],
  );

  const close = useCallback(() => setPosition(null), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    return () => el.removeEventListener("contextmenu", handleContextMenu);
  }, [containerRef, handleContextMenu]);

  useEffect(() => {
    if (!position) return;
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
  }, [position, close]);

  // Keep menu inside the viewport — same offsetWidth/Height approach as
  // DocsTableContextMenu to avoid the zoom-in animation distorting
  // getBoundingClientRect mid-animation.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!position || !el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const PAD = 8;
    let x = position.x;
    let y = position.y;
    if (x + width + PAD > vpW) x = Math.max(PAD, vpW - width - PAD);
    if (y + height + PAD > vpH) y = Math.max(PAD, vpH - height - PAD);
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [position]);

  if (!position) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
    >
      <InsertCommentMenuItem
        className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
        onSelect={() => {
          onInsertComment();
          close();
        }}
      />
    </div>
  );
}
