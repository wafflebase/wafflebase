import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/api/auth";
import { fetchDocument, fetchDocuments } from "@/api/documents";
import { fileUrl } from "@/api/files";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

/**
 * Markup Radix renders for an open dismissable layer: the header's
 * ShareDialog, the mobile sidebar Sheet, the notification Popover, any
 * dropdown/select content. Every one of them closes on Esc from a
 * *document*-level listener and none stops propagation, so an Esc meant for
 * the overlay would otherwise also reach the viewer's key handler and
 * navigate the user out from behind the closing overlay.
 */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  // Anything else Radix hosts in a popper (hover card, combobox content).
  // Matched on the *content* element, never the wrapper: the wrapper is also
  // what a tooltip mounts into, and tooltips open on plain hover or keyboard
  // focus — including the sidebar's nav tooltips, which stay invisible on an
  // expanded desktop sidebar (`hidden` on TooltipContent) — so keying off the
  // wrapper would let a hovered nav item silently kill Esc and prev/next.
  // Requiring `data-state="open"` excludes them twice over: a tooltip reports
  // `instant-open`/`delayed-open`, never `open`. It also disarms the guard as
  // soon as a real overlay starts closing, instead of holding it through the
  // exit animation.
  '[data-radix-popper-content-wrapper] > [data-state="open"]:not([data-slot="tooltip-content"])',
].join(",");

function hasOpenOverlay(): boolean {
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null;
}

export function ImageViewer({
  documentId,
  token,
  onClose,
}: {
  documentId: string;
  token?: string;
  /**
   * Leaves the viewer for the documents list on Esc. Omitted by the
   * anonymous share-link mount, which has no list to return to.
   */
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const downloadName = useRef<string>("image");

  // Load the current image bytes via the authed endpoint → object URL. A
  // share token (anonymous viewer) rides along in the URL so the backend's
  // OptionalJwtAuthGuard route can authorize the read without a session.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setError(false);
    setZoom(1);
    (async () => {
      try {
        const res = await fetchWithAuth(fileUrl(documentId, token));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, token]);

  // Workspace prev/next navigation calls fully JWT-gated documents
  // endpoints (no share-token fallback), so an anonymous share viewer
  // can't reach them — disable both queries rather than firing a request
  // that 401s and forces a login redirect. The viewer just sees the image
  // without the arrows.
  const { data: current } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: !token,
  });
  useEffect(() => {
    if (!current?.title) return;
    const ext = current.fileId?.split(".").pop();
    downloadName.current =
      ext && !current.title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
        ? `${current.title}.${ext}`
        : current.title;
  }, [current?.title, current?.fileId]);

  // Sibling images in the same folder, stably ordered, for prev/next. Scoped
  // to the folder and not just the workspace, so the arrows walk the list the
  // user was actually browsing — stepping into another folder's images would
  // also change where the back button returns to.
  const { data: allDocs = [] } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
    enabled: !token,
  });
  const siblings = useMemo(() => {
    if (!current) return [] as string[];
    return allDocs
      .filter(
        (d) =>
          d.type === "image" &&
          d.workspaceId === current.workspaceId &&
          // Absent and null both mean the workspace root.
          (d.folderId ?? null) === (current.folderId ?? null),
      )
      .sort((a, b) =>
        a.title === b.title
          ? String(a.id).localeCompare(String(b.id))
          : a.title.localeCompare(b.title),
      )
      .map((d) => String(d.id));
  }, [allDocs, current]);

  const index = siblings.indexOf(documentId);
  const prevId = index > 0 ? siblings[index - 1] : undefined;
  const nextId =
    index >= 0 && index < siblings.length - 1
      ? siblings[index + 1]
      : undefined;

  const go = useCallback(
    (id?: string) => id && navigate(`/f/${id}`),
    [navigate],
  );

  // Registered in the capture phase on purpose: an overlay can only be
  // recognised as open *before* Radix's own document-level handler unmounts
  // it, and window-capture runs ahead of document-bubble.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      // The keystroke belongs to whatever is layered over the viewer.
      if (hasOpenOverlay()) return;
      if (e.key === "ArrowLeft") go(prevId);
      else if (e.key === "ArrowRight") go(nextId);
      else if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, prevId, nextId, onClose]);

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-auto bg-muted/30">
      {error ? (
        <p className="text-sm text-muted-foreground">Failed to load image.</p>
      ) : src ? (
        <img
          src={src}
          alt={downloadName.current}
          style={{ transform: `scale(${zoom})` }}
          className="max-h-full max-w-full object-contain transition-transform"
        />
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {prevId && (
        <Button
          variant="secondary"
          size="icon"
          aria-label="Previous image"
          className="absolute left-4 top-1/2 -translate-y-1/2"
          onClick={() => go(prevId)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      {nextId && (
        <Button
          variant="secondary"
          size="icon"
          aria-label="Next image"
          className="absolute right-4 top-1/2 -translate-y-1/2"
          onClick={() => go(nextId)}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      )}

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
