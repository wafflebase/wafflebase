import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/api/auth";
import { fetchDocument, fetchDocuments } from "@/api/documents";
import { fileUrl } from "@/api/files";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

export function ImageViewer({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const downloadName = useRef<string>("image");

  // Load the current image bytes via the authed endpoint → object URL.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setError(false);
    setZoom(1);
    (async () => {
      try {
        const res = await fetchWithAuth(fileUrl(documentId));
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
  }, [documentId]);

  const { data: current } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });
  useEffect(() => {
    if (!current?.title) return;
    const ext = current.fileId?.split(".").pop();
    downloadName.current =
      ext && !current.title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
        ? `${current.title}.${ext}`
        : current.title;
  }, [current?.title, current?.fileId]);

  // Sibling images in the same workspace, stably ordered, for prev/next.
  const { data: allDocs = [] } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });
  const siblings = useMemo(() => {
    if (!current) return [] as string[];
    return allDocs
      .filter(
        (d) => d.type === "image" && d.workspaceId === current.workspaceId,
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
      if (e.key === "ArrowLeft") go(prevId);
      else if (e.key === "ArrowRight") go(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prevId, nextId]);

  const download = useCallback(() => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = downloadName.current;
    a.click();
  }, [src]);

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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Download image"
          onClick={download}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
