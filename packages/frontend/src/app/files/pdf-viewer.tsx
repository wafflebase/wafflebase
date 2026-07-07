import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Cap page width so pages don't grow unreadably wide on large viewports.
const MAX_PAGE_WIDTH = 1000;
// Rasterize a page once it comes within this margin of the viewport, so
// scrolling reveals sharp pages without rendering the whole document upfront.
const PREFETCH_MARGIN = "600px 0px";

type PageDim = { width: number; height: number };

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
    onProgress(received / total);
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
export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
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
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const data = await fetchPdf(fileUrl, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data }).promise;
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
}: {
  pdfRef: React.RefObject<PDFDocumentProxy | null>;
  pageNumber: number;
  dim: PageDim;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Bitmap width already rendered; used to skip re-raster unless the page grew.
  const rasteredWidthRef = useRef(0);
  const [visible, setVisible] = useState(false);

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

    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    rasteredWidthRef.current = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }, [pdfRef, pageNumber]);

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
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
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
      className="my-4 w-full self-center bg-white shadow"
      style={{ aspectRatio: `${dim.width} / ${dim.height}` }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
