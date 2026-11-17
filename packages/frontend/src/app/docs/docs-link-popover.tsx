import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { type EditorAPI, normalizeLinkUrl, isSafeUrl } from "@wafflebase/docs";
import { IconEdit, IconUnlink } from "@tabler/icons-react";

interface LinkHoverInfo {
  href: string;
  rect: { x: number; y: number; width: number; height: number };
}

type Mode = "view" | "edit";

interface DocsLinkPopoverProps {
  editor: EditorAPI | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** External request to open the popover in edit mode (Ctrl+K, toolbar) */
  editRequest: {
    initialUrl: string;
    position: { x: number; y: number; height: number };
  } | null;
  onEditRequestHandled: () => void;
  /**
   * Viewer / read-only mode. When set, the popover shows only the
   * open-link affordance — the Edit and Remove-link buttons (both mutate
   * the document) are hidden. See issue #482.
   */
  readOnly?: boolean;
}

/** Gap kept between the popover and the window edges. */
const POPOVER_MARGIN = 8;

/**
 * Place a `size` box at `anchor` inside `viewport`, `POPOVER_MARGIN` from
 * every edge. Horizontally it slides left; vertically it flips above the
 * anchor (its bottom at `flipTop`) when it would run past the bottom,
 * and is pinned to the top margin if that does not fit either.
 */
function clampPopover(
  anchor: { x: number; top: number; flipTop: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const m = POPOVER_MARGIN;
  const x = Math.max(m, Math.min(anchor.x, viewport.width - size.width - m));
  let y = anchor.top;
  if (y + size.height + m > viewport.height) {
    const above = anchor.flipTop - size.height;
    y = above >= m ? above : viewport.height - size.height - m;
  }
  return { x, y: Math.max(m, y) };
}

/**
 * Unified link popover: shows URL + action buttons when the cursor is inside
 * a link (view mode), or a URL input field when inserting/editing a link
 * (edit mode). Rendered via Portal with position:fixed.
 */
export function DocsLinkPopover({
  editor,
  containerRef,
  editRequest,
  onEditRequestHandled,
  readOnly,
}: DocsLinkPopoverProps) {
  const [linkInfo, setLinkInfo] = useState<LinkHoverInfo | undefined>();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editUrl, setEditUrl] = useState("");
  /**
   * The href edit mode was entered on, or `null` when it was entered on a
   * caret with no link (⌘K over a selection or an empty caret).
   *
   * The popover deliberately stays open when the caret leaves the link, so
   * Apply after clicking into the body used to insert the URL as plain text
   * at the new caret instead of editing anything (#1038). The *href* is
   * kept rather than a boolean because the caret can also have moved into a
   * different hyperlink, where `insertLink` would rewrite that one — a
   * silent edit to a link the user never opened.
   */
  const [editingHref, setEditingHref] = useState<string | null>(null);
  /**
   * Set when Apply refused because the caret is no longer on the link this
   * popover was opened for. Shown rather than swallowed: the typed URL is
   * the user's work, so the popover stays open holding it.
   */
  const [applyError, setApplyError] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState<{
    x: number;
    y: number;
    height: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Wire up the onCursorLinkChange callback from the editor
  useEffect(() => {
    if (!editor) return;
    editor.onCursorLinkChange((info) => {
      if (info) {
        setLinkInfo(info);
        // Only switch to view mode if we're not already editing
        setMode((prev) => (prev === "edit" ? prev : "view"));
        setVisible(true);
      } else {
        // Don't dismiss if in edit mode
        setVisible((prev) => {
          if (mode === "edit") return prev;
          return false;
        });
        if (mode !== "edit") setLinkInfo(undefined);
      }
    });
    return () => {
      editor.onCursorLinkChange(() => {});
    };
  }, [editor, mode]);

  // Handle external edit requests (Ctrl+K, toolbar button)
  useEffect(() => {
    if (!editRequest) return;
    setEditUrl(editRequest.initialUrl);
    // A prefilled URL means ⌘K/toolbar found a link at the caret — and it
    // is that link's own href, which is what Apply has to re-check against.
    setEditingHref(editRequest.initialUrl || null);
    setApplyError(null);
    setEditPosition(editRequest.position);
    setMode("edit");
    setVisible(true);
    onEditRequestHandled();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [editRequest, onEditRequestHandled]);

  // Focus input when switching to edit mode
  useEffect(() => {
    if (mode === "edit" && visible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [mode, visible]);

  // Dismiss on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visible) return;
    const handleScroll = () => {
      setVisible(false);
      setLinkInfo(undefined);
      setMode("view");
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, visible]);

  const close = useCallback(() => {
    setVisible(false);
    setLinkInfo(undefined);
    setMode("view");
    setEditingHref(null);
    setApplyError(null);
  }, []);

  // --- View mode handlers ---

  const handleEdit = useCallback(() => {
    if (!linkInfo) return;
    setEditUrl(linkInfo.href);
    setEditingHref(linkInfo.href);
    setApplyError(null);
    setEditPosition({
      x: linkInfo.rect.x,
      y: linkInfo.rect.y,
      height: linkInfo.rect.height,
    });
    setMode("edit");
  }, [linkInfo]);

  const handleRemove = useCallback(() => {
    if (!editor) return;
    editor.removeLink();
    editor.focus();
    close();
  }, [editor, close]);

  // --- Edit mode handlers ---

  const handleApply = useCallback(() => {
    if (!editor || !editUrl.trim()) return;
    const url = normalizeLinkUrl(editUrl);
    if (!url) return;
    // The caret has since left the link this popover was editing — applying
    // would insert the URL as text wherever the caret went, or, if the
    // caret landed in *another* hyperlink, quietly rewrite that one
    // instead (#1038). Keep the typed URL and say so rather than close.
    if (editingHref !== null && editor.getLinkAtCursor() !== editingHref) {
      setApplyError("The cursor left this link. Click it again to edit it.");
      return;
    }
    editor.insertLink(url);
    editor.focus();
    close();
  }, [editor, editUrl, editingHref, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleApply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        editor?.focus();
        close();
      }
    },
    [handleApply, editor, close],
  );

  // Anchor: the caret (edit) or the link (view). The popover opens below
  // it, left-aligned to it.
  const anchor =
    mode === "edit" && editPosition
      ? { x: editPosition.x, y: editPosition.y, height: editPosition.height }
      : linkInfo
        ? { x: linkInfo.rect.x, y: linkInfo.rect.y, height: linkInfo.rect.height }
        : null;
  const top = anchor ? anchor.y + anchor.height + 4 : 0;
  const left = anchor ? anchor.x : 0;

  // Keep the popover inside the window. A caret near the end of a line
  // on a phone put its left edge past the middle of the screen and the
  // Apply button off it. Runs after every render (the box's size depends
  // on mode and the error line) and writes the style directly, so the
  // clamped position lands before paint.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !anchor) return;
    const pos = clampPopover(
      { x: left, top, flipTop: anchor.y - 4 },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  });

  if (!visible || !anchor) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 flex items-center gap-1.5 rounded-md border bg-popover p-1.5 text-xs text-popover-foreground shadow-md"
      style={{
        top,
        left,
        minWidth: `min(280px, calc(100vw - ${2 * POPOVER_MARGIN}px))`,
        maxWidth: `min(400px, calc(100vw - ${2 * POPOVER_MARGIN}px))`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {mode === "view" && linkInfo ? (
        <>
          <a
            href={isSafeUrl(linkInfo.href) ? linkInfo.href : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 min-w-0 flex-1 items-center truncate rounded border bg-background px-2 text-xs text-link no-underline underline-offset-2 hover:underline"
            title={linkInfo.href}
            onClick={(e) => {
              e.stopPropagation();
              if (!isSafeUrl(linkInfo.href)) e.preventDefault();
            }}
          >
            {linkInfo.href.length > 40
              ? linkInfo.href.slice(0, 37) + "..."
              : linkInfo.href}
          </a>
          {!readOnly && (
            <>
              <button
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
                onClick={handleEdit}
                aria-label="Edit link"
                title="Edit link"
              >
                <IconEdit size={14} />
              </button>
              <button
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
                onClick={handleRemove}
                aria-label="Remove link"
                title="Remove link"
              >
                <IconUnlink size={14} />
              </button>
            </>
          )}
        </>
      ) : mode === "edit" ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="url"
              aria-label="Link URL"
              className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-base md:text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              placeholder="Enter URL"
              value={editUrl}
              onChange={(e) => {
                setEditUrl(e.target.value);
                setApplyError(null);
              }}
              onKeyDown={handleKeyDown}
            />
            <button
              className="inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded bg-primary px-3 text-xs text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              onClick={handleApply}
              disabled={!editUrl.trim()}
            >
              Apply
            </button>
          </div>
          {applyError && (
            <span role="alert" className="px-0.5 text-xs text-destructive">
              {applyError}
            </span>
          )}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
