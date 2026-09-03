import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamTextContent = vi.fn();
const textLayerRender = vi.fn();
const textLayerCancel = vi.fn();
// Every TextLayer the viewer constructs, so tests can assert how many pages
// got one and what each was handed.
const textLayerCalls: Array<{ container: HTMLElement }> = [];

vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.mjs",
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  const viewport = {
    width: 612,
    height: 792,
    scale: 1,
    rotation: 0,
    rawDims: { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 },
  };
  const page = {
    getViewport: () => viewport,
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    streamTextContent,
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 2, getPage: async () => page }),
      destroy: () => Promise.resolve(),
    }),
    TextLayer: class {
      constructor(opts: { container: HTMLElement }) {
        textLayerCalls.push(opts);
      }
      render = textLayerRender;
      cancel = textLayerCancel;
      textDivs: HTMLElement[] = [];
    },
  };
});

const { PdfViewer } = await import("../pdf-viewer.tsx");

beforeEach(() => {
  textLayerCalls.length = 0;
  textLayerRender.mockReset().mockResolvedValue(undefined);
  textLayerCancel.mockReset();
  streamTextContent.mockReset().mockReturnValue({ __stream: true });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
  // jsdom has no layout, so a page wrapper measures 0 wide and the layer
  // would be skipped as unmeasurable. Give it a width.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
});

describe("PdfViewer text layer", () => {
  it("builds one selectable text layer per page", async () => {
    render(<PdfViewer fileUrl="/f/1" />);

    await waitFor(() => {
      expect(screen.getAllByTestId("pdf-text-layer")).toHaveLength(2);
    });
    await waitFor(() => expect(textLayerCalls).toHaveLength(2));
    // The layer must be handed the page's streamed text, not re-derived.
    expect(streamTextContent).toHaveBeenCalledTimes(2);
    expect(textLayerRender).toHaveBeenCalledTimes(2);
  });

  it("sizes the layer to the rendered page and carries the render scale", async () => {
    render(<PdfViewer fileUrl="/f/1" />);

    await waitFor(() => expect(textLayerCalls).toHaveLength(2));
    const layer = screen.getAllByTestId("pdf-text-layer")[0]!;

    await waitFor(() => expect(layer.style.width).toBe("1000px"));
    // Spans are positioned in percentages of the page box; this variable is
    // the only thing that scales them to the canvas beside them.
    expect(layer.style.getPropertyValue("--total-scale-factor")).toBe(
      String(1000 / 612),
    );
  });

  it("stacks the text layer above the canvas and below the overlay", async () => {
    render(
      <PdfViewer
        fileUrl="/f/1"
        renderPageOverlay={(i) => <div data-testid={`overlay-${i}`} />}
      />,
    );

    await waitFor(() => expect(textLayerCalls).toHaveLength(2));
    const layer = screen.getAllByTestId("pdf-text-layer")[0]!;
    const siblings = Array.from(layer.parentElement!.children);

    // Order is the whole mechanism: pixels, then selection, then comment pins.
    expect(siblings.findIndex((el) => el.tagName === "CANVAS")).toBeLessThan(
      siblings.indexOf(layer),
    );
    expect(siblings.indexOf(layer)).toBeLessThan(
      siblings.indexOf(screen.getByTestId("overlay-0")),
    );
  });

  it("keeps the page readable when the text layer fails", async () => {
    // A malformed text stream, or an environment with no 2D canvas context
    // for glyph measurement. The document must still open.
    textLayerRender.mockRejectedValue(new Error("no 2d context"));

    render(<PdfViewer fileUrl="/f/1" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-pages")).toBeTruthy();
    });
    await waitFor(() => expect(textLayerCalls).toHaveLength(2));
    expect(screen.getAllByTestId("pdf-text-layer")).toHaveLength(2);
  });
});
