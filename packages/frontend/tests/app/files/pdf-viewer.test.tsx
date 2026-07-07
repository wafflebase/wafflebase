import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// Mock pdfjs-dist so the test never loads the real worker/engine.
vi.mock("pdfjs-dist", () => {
  const page = {
    getViewport: () => ({ width: 100, height: 140 }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 2, getPage: async () => page }),
      destroy: () => Promise.resolve(),
    }),
  };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { PdfViewer } from "@/app/files/pdf-viewer";

beforeEach(() => {
  // jsdom canvas has no real 2d context; stub it so the viewer appends canvases.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as never;
});

describe("PdfViewer", () => {
  it("renders a fit-to-width canvas per page after loading", async () => {
    const { container } = render(<PdfViewer fileUrl="/documents/d1/file" />);
    await waitFor(() =>
      expect(container.querySelectorAll("canvas").length).toBe(2),
    );
    // Each page is wrapped in an aspect-ratio placeholder so layout reserves
    // correct space and reflows to the container width via CSS.
    expect(
      container.querySelectorAll('[style*="aspect-ratio"]').length,
    ).toBe(2);
  });
});
