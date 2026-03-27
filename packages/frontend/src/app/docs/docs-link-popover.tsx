import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { EditorAPI } from "@wafflebase/docs";
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
}: DocsLinkPopoverProps) {
  const [linkInfo, setLinkInfo] = useState<LinkHoverInfo | undefined>();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editUrl, setEditUrl] = useState("");
  const [editPosition, setEditPosition] = useState<{
    x: number;
    y: number;
    height: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, []);

  // --- View mode handlers ---

  const handleEdit = useCallback(() => {
    if (!linkInfo) return;
    setEditUrl(linkInfo.href);
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
    editor.insertLink(editUrl.trim());
    editor.focus();
    close();
  }, [editor, editUrl, close]);

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

  if (!visible) return null;

  // Determine position based on mode
  let top: number;
  let left: number;

  if (mode === "edit" && editPosition) {
    top = editPosition.y + editPosition.height + 4;
    left = editPosition.x;
  } else if (linkInfo) {
    top = linkInfo.rect.y + linkInfo.rect.height + 4;
    left = linkInfo.rect.x;
  } else {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-50 flex items-center gap-1.5 rounded-md border bg-popover p-1.5 text-xs text-popover-foreground shadow-md"
      style={{ top, left, minWidth: 280, maxWidth: 400 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {mode === "view" && linkInfo ? (
        <>
          <a
            href={linkInfo.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 flex-1 items-center truncate rounded border bg-background px-2 text-xs text-blue-600 no-underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            title={linkInfo.href}
            onClick={(e) => e.stopPropagation()}
          >
            {linkInfo.href.length > 40
              ? linkInfo.href.slice(0, 37) + "..."
              : linkInfo.href}
          </a>
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
      ) : mode === "edit" ? (
        <>
          <input
            ref={inputRef}
            type="url"
            className="h-7 flex-1 rounded border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            placeholder="Enter URL"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleApply}
            disabled={!editUrl.trim()}
          >
            Apply
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
