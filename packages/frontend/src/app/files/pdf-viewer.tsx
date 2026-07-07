import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Renders a PDF read-only. `pdfjs-dist` (the large engine) is imported
 * dynamically so it stays in its own lazy chunk, off the main bundle and
 * clear of the frontend chunk gate. The worker is referenced by URL only.
 */
export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        for (let n = 1; n <= pdf.numPages; n++) {
          const pdfPage = await pdf.getPage(n);
          if (cancelled) return;
          const viewport = pdfPage.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto my-4 shadow";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "PDF error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

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
