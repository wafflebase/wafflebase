import { useEffect, useRef, useState, useCallback } from "react";
import type { EditorAPI } from "@wafflebase/docs";
import { IconExternalLink, IconEdit, IconUnlink } from "@tabler/icons-react";

interface LinkHoverInfo {
  href: string;
  rect: { x: number; y: number; width: number; height: number };
}

interface DocsLinkPopoverProps {
  editor: EditorAPI | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * DOM overlay popover that appears when the user hovers over a hyperlink
 * in the Canvas-based document editor. Shows the URL, with buttons to
 * open, edit, or remove the link.
 */
export function DocsLinkPopover({ editor, containerRef }: DocsLinkPopoverProps) {
  const [linkInfo, setLinkInfo] = useState<LinkHoverInfo | undefined>();
  const [visible, setVisible] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dismissTimer = useRef<number | undefined>(undefined);
  const isHoveringPopover = useRef(false);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimer.current !== undefined) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = undefined;
    }
  }, []);

  const scheduleDismiss = useCallback((delay = 300) => {
    clearDismissTimer();
    dismissTimer.current = window.setTimeout(() => {
      if (!isHoveringPopover.current) {
        setVisible(false);
        setLinkInfo(undefined);
      }
    }, delay);
  }, [clearDismissTimer]);

  // Wire up the onLinkHover callback from the editor
  useEffect(() => {
    if (!editor) return;
    editor.onLinkHover((info) => {
      if (info) {
        clearDismissTimer();
        setLinkInfo(info);
        setVisible(true);
      } else {
        // Mouse moved off link — schedule dismiss with delay to allow
        // the user to move into the popover
        scheduleDismiss();
      }
    });
    return () => {
      editor.onLinkHover(() => {});
    };
  }, [editor, clearDismissTimer, scheduleDismiss]);

  // Dismiss on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visible) return;
    const handleScroll = () => {
      setVisible(false);
      setLinkInfo(undefined);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, visible]);

  // Dismiss on click outside
  useEffect(() => {
    if (!visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setVisible(false);
        setLinkInfo(undefined);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible]);

  const handlePopoverMouseEnter = useCallback(() => {
    isHoveringPopover.current = true;
    clearDismissTimer();
  }, [clearDismissTimer]);

  const handlePopoverMouseLeave = useCallback(() => {
    isHoveringPopover.current = false;
    scheduleDismiss();
  }, [scheduleDismiss]);

  const handleOpen = useCallback(() => {
    if (linkInfo) {
      window.open(linkInfo.href, "_blank", "noopener,noreferrer");
    }
    setVisible(false);
  }, [linkInfo]);

  const handleEdit = useCallback(() => {
    if (!editor) return;
    // Trigger the Ctrl+K link dialog flow
    const url = window.prompt("Edit URL:", linkInfo?.href ?? "");
    if (url !== null && url !== "") {
      editor.insertLink(url);
    }
    editor.focus();
    setVisible(false);
  }, [editor, linkInfo]);

  const handleRemove = useCallback(() => {
    if (!editor) return;
    editor.removeLink();
    editor.focus();
    setVisible(false);
  }, [editor]);

  if (!visible || !linkInfo) return null;

  // Truncate URL for display
  const displayUrl =
    linkInfo.href.length > 45
      ? linkInfo.href.slice(0, 42) + "..."
      : linkInfo.href;

  // Position the popover below the link rect, relative to the container
  const top = linkInfo.rect.y + linkInfo.rect.height + 4;
  const left = linkInfo.rect.x;

  return (
    <div
      ref={popoverRef}
      onMouseEnter={handlePopoverMouseEnter}
      onMouseLeave={handlePopoverMouseLeave}
      className="absolute z-50 flex items-center gap-1 rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ top, left, maxWidth: 360 }}
    >
      <a
        href={linkInfo.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mr-1 truncate text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        title={linkInfo.href}
        onClick={(e) => e.stopPropagation()}
      >
        {displayUrl}
      </a>
      <button
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
        onClick={handleOpen}
        aria-label="Open link"
        title="Open link"
      >
        <IconExternalLink size={14} />
      </button>
      <button
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
        onClick={handleEdit}
        aria-label="Edit link"
        title="Edit link"
      >
        <IconEdit size={14} />
      </button>
      <button
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
        onClick={handleRemove}
        aria-label="Remove link"
        title="Remove link"
      >
        <IconUnlink size={14} />
      </button>
    </div>
  );
}
