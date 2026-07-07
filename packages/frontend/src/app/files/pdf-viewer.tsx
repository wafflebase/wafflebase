import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Fit each page to the container width, clamped so pages neither overflow
// on narrow viewports nor grow unreadably wide on large ones.
const MAX_PAGE_WIDTH = 1000;
const MIN_PAGE_WIDTH = 320;
// Horizontal padding of the scroll container (`p-4` → 16px each side).
const CONTAINER_PADDING_X = 32;

/**
 * Renders a PDF read-only, fit to the container's width. `pdfjs-dist` (the
 * large engine) is imported dynamically so it stays in its own lazy chunk,
 * off the main bundle and clear of the frontend chunk gate. The worker is
 * referenced by URL only.
 */
export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  // Monotonic render token: a newer render (e.g. from a resize) supersedes
  // an in-flight one so concurrent passes don't fight over the DOM.
  const renderTokenRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const renderPages = useCallback(async () => {
    const pdf = pdfRef.current;
    const container = containerRef.current;
    if (!pdf || !container) return;

    const token = ++renderTokenRef.current;
    const dpr = window.devicePixelRatio || 1;
    const available = container.clientWidth - CONTAINER_PADDING_X;
    const targetWidth = Math.min(
      MAX_PAGE_WIDTH,
      Math.max(MIN_PAGE_WIDTH, available),
    );

    // Build into a detached fragment and swap in once, so a resize re-render
    // doesn't flash an empty viewer.
    const fragment = document.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      if (token !== renderTokenRef.current) return; // superseded
      const base = page.getViewport({ scale: 1 });
      const cssScale = targetWidth / base.width;
      // Render the bitmap at device resolution, then downscale via CSS so
      // pages stay crisp on HiDPI screens.
      const viewport = page.getViewport({ scale: cssScale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${targetWidth}px`;
      canvas.style.height = `${base.height * cssScale}px`;
      canvas.className = "mx-auto my-4 shadow bg-white";
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      fragment.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (token !== renderTokenRef.current) return; // superseded mid-render
    }
    if (token !== renderTokenRef.current) return;
    container.replaceChildren(fragment);
  }, []);

  // Load the document once per fileUrl, then render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const res = await fetch(fileUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`);
        const data = await res.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        await renderPages();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "PDF error");
      }
    })();
    return () => {
      cancelled = true;
      pdfRef.current = null;
    };
  }, [fileUrl, renderPages]);

  // Re-fit on viewport / container size changes (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void renderPages(), 100);
    };
    window.addEventListener("resize", schedule);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      observer = new ResizeObserver(schedule);
      observer.observe(containerRef.current);
    }
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [renderPages]);

  if (error) {
    return <div className="p-8 text-center text-red-500">{error}</div>;
  }
  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-muted/30 p-4"
      data-testid="pdf-pages"
    />
  );
}
