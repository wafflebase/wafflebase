import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
// Use the legacy build: it ships polyfills (e.g. `Uint8Array.prototype.toHex`,
// which pdf.js calls when computing document fingerprints during
// getDocument()). The modern build assumes those TC39 APIs exist and throws
// "a.toHex is not a function" on browsers below Chrome ~140 / Safari 18.2 /
// Firefox 133, breaking PDF loading entirely.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// Cap page width so pages don't grow unreadably wide on large viewports.
const MAX_PAGE_WIDTH = 1000;
// Rasterize a page once it comes within this margin of the viewport, so
// scrolling reveals sharp pages without rendering the whole document upfront.
const PREFETCH_MARGIN = "600px 0px";

type PageDim = { width: number; height: number };
// Structural subset of pdf.js's RenderTask (avoids depending on the exported
// type name across versions).
type RenderTaskLike = { promise: Promise<void>; cancel: () => void };

/**
 * Fetch the PDF while reporting download progress. Streams the body when the
 * server provides `Content-Length`; otherwise falls back to a single read and
 * reports indeterminate progress (`null`).
 */
async function fetchPdf(
  url: string,
  onProgress: (fraction: number | null) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`);
  const total = Number(res.headers?.get?.("Content-Length")) || 0;
  if (!res.body || !total) {
    onProgress(null);
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out.buffer;
}

/**
 * Renders a PDF read-only, fit to the container width. `pdfjs-dist` (the large
 * engine) is imported dynamically so it stays in its own lazy chunk, off the
 * main bundle and clear of the frontend chunk gate.
 *
 * Layout reflows instantly via CSS (aspect-ratio placeholders + `width:100%`
 * canvases), so window resizes and sidebar collapse/expand feel immediate;
 * pages are rasterized lazily as they scroll into view and re-sharpened in the
 * background when their display width grows.
 */
export function PdfViewer({
  fileUrl,
  renderPageOverlay,
  onActivePageChange,
}: {
  fileUrl: string;
  renderPageOverlay?: (pageIndex: number) => React.ReactNode;
  onActivePageChange?: (pageIndex: number) => void;
}) {
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  // The getDocument() loading task owns teardown (destroy) — the resolved
  // document proxy does not expose it in every pdf.js version.
  const loadingTaskRef = useRef<{ destroy?: () => Promise<void> } | null>(null);
  const [pages, setPages] = useState<PageDim[]>([]);
  const [progress, setProgress] = useState<number | null>(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setProgress(0);
    setPages([]);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const data = await fetchPdf(fileUrl, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (cancelled) return;
        // cMapUrl/standardFontDataUrl point at pdf.js's bundled assets,
        // served by the `pdfjs-assets` Vite plugin. Without them, CID-keyed
        // fonts (e.g. CJK PDFs) render blank and non-embedded standard fonts
        // fall back incorrectly.
        const loadingTask = pdfjs.getDocument({
          data,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfRef.current = pdf;

        // Collect natural page dimensions so placeholders reserve correct
        // space (and the scrollbar is accurate) before any raster.
        const dims: PageDim[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const vp = page.getViewport({ scale: 1 });
          dims.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setPages(dims);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : "PDF error");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      pdfRef.current = null;
      // Release the pdf.js document + worker transport and cached page bitmaps
      // via the loading task; otherwise each fileUrl change / unmount leaks
      // them. Guard the method — some pdf.js versions omit it.
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (task && typeof task.destroy === "function") {
        void task.destroy().catch(() => undefined);
      }
    };
  }, [fileUrl]);

  if (status === "error") {
    return <div className="p-8 text-center text-red-500">{errorMsg}</div>;
  }

  return (
    <div
      className="relative flex-1 overflow-auto bg-muted/30"
      data-testid="pdf-pages"
    >
      {status === "loading" && <LoadingOverlay progress={progress} />}
      <div
        className="mx-auto flex w-full flex-col items-stretch px-4 py-4"
        style={{ maxWidth: MAX_PAGE_WIDTH }}
      >
        {pages.map((dim, i) => (
          <PdfPageView
            key={i}
            pdfRef={pdfRef}
            pageNumber={i + 1}
            dim={dim}
            overlay={renderPageOverlay?.(i)}
            onActive={onActivePageChange ? () => onActivePageChange(i) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function LoadingOverlay({ progress }: { progress: number | null }) {
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted-foreground/20">
        <div
          className={
            pct === null
              ? "h-full w-1/3 animate-pulse rounded-full bg-primary"
              : "h-full rounded-full bg-primary transition-[width] duration-150"
          }
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {pct === null ? "Loading PDF…" : `Loading PDF… ${pct}%`}
      </span>
    </div>
  );
}

function PdfPageView({
  pdfRef,
  pageNumber,
  dim,
  overlay,
  onActive,
}: {
  pdfRef: React.RefObject<PDFDocumentProxy | null>;
  pageNumber: number;
  dim: PageDim;
  overlay?: React.ReactNode;
  onActive?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Bitmap width already rendered; used to skip re-raster unless the page grew.
  const rasteredWidthRef = useRef(0);
  // In-flight pdf.js render, so a wider re-raster can cancel it — pdf.js
  // forbids two concurrent render() calls on one canvas.
  const renderTaskRef = useRef<RenderTaskLike | null>(null);
  const [visible, setVisible] = useState(false);
  // Read via ref (not an effect dep) so a parent that passes a fresh inline
  // callback each render doesn't tear down and recreate the observer.
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  // Rasterize this page at its current display width × device pixel ratio.
  const raster = useCallback(async () => {
    const pdf = pdfRef.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !wrap || !canvas) return;
    const cssWidth = wrap.clientWidth;
    if (cssWidth <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const targetBitmapWidth = Math.round(cssWidth * dpr);
    // Only (re)raster when the display grew beyond the current bitmap; CSS has
    // already scaled the existing bitmap to fit, so shrinking needs no work.
    if (targetBitmapWidth <= rasteredWidthRef.current) return;

    // Cancel a still-running render before starting a wider one.
    renderTaskRef.current?.cancel();

    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    rasteredWidthRef.current = viewport.width;

    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (e) {
      // A newer, wider raster cancelled this one — expected; ignore it.
      if ((e as { name?: string } | null)?.name !== "RenderingCancelledException") {
        // Genuine render failure: let a later resize retry this page.
        if (rasteredWidthRef.current === viewport.width) {
          rasteredWidthRef.current = 0;
        }
      }
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    }
  }, [pdfRef, pageNumber]);

  // Cancel any in-flight render on unmount so it can't reject after teardown.
  useEffect(() => () => renderTaskRef.current?.cancel(), []);

  // Lazy: mark visible when near the viewport (or eagerly where there's no
  // IntersectionObserver, e.g. jsdom).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          onActiveRef.current?.();
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (visible) void raster();
  }, [visible, raster]);

  // Re-sharpen when the page grows (window resize, sidebar expand). CSS has
  // already reflowed instantly; this only upgrades bitmap resolution.
  useEffect(() => {
    if (!visible) return;
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void raster(), 150);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [visible, raster]);

  return (
    <div
      ref={wrapRef}
      className="relative my-4 w-full self-center bg-white shadow"
      style={{ aspectRatio: `${dim.width} / ${dim.height}` }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {overlay}
    </div>
  );
}
