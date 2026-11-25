/**
 * The QR code is the only thing in the app whose correctness a reader
 * cannot check by looking at it, so the matrix is asserted against the
 * spec's own geometry: the right module count for the version, a quiet
 * zone that is actually quiet, and the three finder patterns in place.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  encodeQr,
  qrCodePngBlob,
  qrCodeSvgDocument,
  qrModulesPath,
  QR_EXPORT_SIZE,
  type QrMatrix,
} from "@/lib/qr-code";
import { QrCode, QrCodePopover } from "./qr-code";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const URL_VALUE = "https://wafflebase.example/shared/abc123";
const QUIET = 4;

/** The 7×7 finder pattern: dark ring, light ring, dark 3×3 core. */
function isFinderAt(m: QrMatrix, top: number, left: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(y - 3), Math.abs(x - 3));
      const dark = ring !== 2;
      if (m.rows[top + y][left + x] !== dark) return false;
    }
  }
  return true;
}

/** jsdom's Blob has no `text()`. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

type Rect = { x: number; y: number; w: number; h: number; fill: string };

/**
 * jsdom has no canvas, so the 2d context is stood in for and every
 * `fillRect` recorded: the module arithmetic is the whole of what this
 * export does, and nothing else can observe it.
 */
function stubCanvas(): Rect[] {
  const rects: Rect[] = [];
  const ctx = {
    fillStyle: "",
    fillRect: (x: number, y: number, w: number, h: number) =>
      rects.push({ x, y, w, h, fill: ctx.fillStyle }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["png"], { type: "image/png" })),
  );
  return rects;
}

/** The cells a `qrModulesPath` path paints, as "x,y". */
function pathCells(d: string): Set<string> {
  const cells = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) cells.add(`${m[1]},${m[2]}`);
  return cells;
}

/** The matrix's dark cells, as "x,y". */
function darkCells(m: QrMatrix): Set<string> {
  const cells = new Set<string>();
  m.rows.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) cells.add(`${x},${y}`);
    }),
  );
  return cells;
}

describe("qrModulesPath", () => {
  it("paints exactly the dark modules, one square each, x before y", () => {
    const m = encodeQr(URL_VALUE);
    const d = qrModulesPath(m);
    // Nothing but module squares: a stray command would be unaccounted for.
    expect(d.replace(/M\d+ \d+h1v1h-1z/g, "")).toBe("");
    // Not symmetric under transpose, so a swapped x/y fails here.
    expect(pathCells(d)).toEqual(darkCells(m));
    expect(d.match(/M/g)).toHaveLength(darkCells(m).size);
  });
});

describe("encodeQr", () => {
  const m = encodeQr(URL_VALUE);
  const inner = m.size - 2 * QUIET;

  it("is a valid version size plus the quiet zone", () => {
    // Version v is 17 + 4v modules per side, v in 1..40.
    expect(m.rows).toHaveLength(m.size);
    expect((inner - 17) % 4).toBe(0);
    expect(inner).toBeGreaterThanOrEqual(21);
  });

  it("keeps the 4-module quiet zone light on every side", () => {
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        const edge =
          y < QUIET || x < QUIET || y >= m.size - QUIET || x >= m.size - QUIET;
        if (edge) expect(m.rows[y][x]).toBe(false);
      }
    }
  });

  it("places the three finder patterns", () => {
    const far = m.size - QUIET - 7;
    expect(isFinderAt(m, QUIET, QUIET)).toBe(true);
    expect(isFinderAt(m, QUIET, far)).toBe(true);
    expect(isFinderAt(m, far, QUIET)).toBe(true);
    expect(isFinderAt(m, far, far)).toBe(false);
  });
});

describe("QrCode", () => {
  it("renders a labelled square matrix for the URL", () => {
    render(<QrCode value={URL_VALUE} />);
    const svg = screen.getByRole("img", { name: "QR code" });
    const viewBox = svg.getAttribute("viewBox")!.split(" ");
    expect(viewBox[2]).toBe(viewBox[3]);
    expect(Number(viewBox[2])).toBe(encodeQr(URL_VALUE).size);
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
  });

  it("always paints dark modules on a white plate, in either theme", () => {
    render(<QrCode value={URL_VALUE} />);
    const svg = screen.getByRole("img", { name: "QR code" });
    expect(svg.querySelector("rect")).toHaveAttribute("fill", "#fff");
    expect(svg.querySelector("path")).toHaveAttribute("fill", "#000");
  });

  it("encodes different URLs differently", () => {
    const { container, rerender } = render(<QrCode value={URL_VALUE} />);
    const first = container.querySelector("path")!.getAttribute("d");
    rerender(<QrCode value={`${URL_VALUE}x`} />);
    expect(container.querySelector("path")!.getAttribute("d")).not.toBe(first);
  });
});

describe("qrCodeSvgDocument", () => {
  it("is a standalone SVG document carrying the same modules", () => {
    const svg = qrCodeSvgDocument(URL_VALUE);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('fill="#000"');
    expect(svg.endsWith("</svg>")).toBe(true);
    const d = svg.match(/<path fill="#000" d="([^"]*)"/)?.[1] ?? "";
    expect(pathCells(d)).toEqual(darkCells(encodeQr(URL_VALUE)));
  });

  it("is the code QrCode renders on screen", () => {
    const { container } = render(<QrCode value={URL_VALUE} />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    expect(qrCodeSvgDocument(URL_VALUE)).toContain(`d="${d}"`);
  });
});

describe("qrCodePngBlob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("paints exactly the dark modules of the matrix, on a white plate", async () => {
    const rects = stubCanvas();
    const blob = await qrCodePngBlob(URL_VALUE);
    expect(blob?.type).toBe("image/png");

    const matrix = encodeQr(URL_VALUE);
    const scale = Math.floor(QR_EXPORT_SIZE / matrix.size);
    const offset = Math.floor((QR_EXPORT_SIZE - scale * matrix.size) / 2);

    // The plate is painted first, over the whole image.
    expect(rects[0]).toEqual({
      x: 0,
      y: 0,
      w: QR_EXPORT_SIZE,
      h: QR_EXPORT_SIZE,
      fill: "#fff",
    });

    const dark = rects.slice(1);
    expect(dark.every((r) => r.fill === "#000")).toBe(true);

    // Each dark rect is one module square, aligned to the grid and inside
    // the image — a centring or scale regression breaks one of the three.
    for (const r of dark) {
      expect([r.w, r.h]).toEqual([scale, scale]);
      expect([(r.x - offset) % scale, (r.y - offset) % scale]).toEqual([0, 0]);
      expect(r.x).toBeGreaterThanOrEqual(offset);
      expect(r.x + r.w).toBeLessThanOrEqual(QR_EXPORT_SIZE - offset);
      expect(r.y + r.h).toBeLessThanOrEqual(QR_EXPORT_SIZE - offset);
    }

    // …and the painted cells are the matrix's dark cells, no more, no fewer.
    const painted = new Set(
      dark.map((r) => `${(r.x - offset) / scale},${(r.y - offset) / scale}`),
    );
    const expected = new Set<string>();
    matrix.rows.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) expected.add(`${x},${y}`);
      }),
    );
    expect(painted).toEqual(expected);
    expect(dark).toHaveLength(expected.size);
  });

  it("leaves the quiet zone of the exported image white", async () => {
    const rects = stubCanvas();
    await qrCodePngBlob(URL_VALUE);

    const matrix = encodeQr(URL_VALUE);
    const scale = Math.floor(QR_EXPORT_SIZE / matrix.size);
    const offset = Math.floor((QR_EXPORT_SIZE - scale * matrix.size) / 2);
    const quiet = offset + QUIET * scale;
    for (const r of rects.slice(1)) {
      expect(r.x).toBeGreaterThanOrEqual(quiet);
      expect(r.y).toBeGreaterThanOrEqual(quiet);
      expect(r.x + r.w).toBeLessThanOrEqual(QR_EXPORT_SIZE - quiet);
      expect(r.y + r.h).toBeLessThanOrEqual(QR_EXPORT_SIZE - quiet);
    }
  });
});

describe("QrCodePopover", () => {
  let saved: { blob: Blob; name: string }[];

  beforeEach(() => {
    saved = [];
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:qr");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0];
        saved.push({ blob: blob as Blob, name: this.download });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function open() {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <QrCodePopover url={URL_VALUE} fileName="share-link-abc" />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Show QR code" }));
    return user;
  }

  it("opens the code for the URL with its export actions", async () => {
    await open();
    expect(
      screen.getByRole("img", { name: "QR code for this link" }),
    ).toBeTruthy();
    expect(screen.getByText(URL_VALUE)).toBeTruthy();
    for (const name of ["Download PNG", "Download SVG", "Copy image"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("keeps the capability URL out of every DOM attribute", async () => {
    // Sentry click breadcrumbs serialize aria-label/title; text is not.
    await open();
    for (const el of document.body.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        expect(attr.value, `${el.tagName}[${attr.name}]`).not.toContain(
          "abc123",
        );
      }
    }
  });

  it("downloads the SVG under the given name", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Download SVG" }));

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("share-link-abc.svg");
    expect(saved[0].blob.type).toBe("image/svg+xml");
    expect(await readText(saved[0].blob)).toBe(qrCodeSvgDocument(URL_VALUE));
    expect(toast.success).toHaveBeenCalledWith("QR code downloaded");
  });

  it("downloads the PNG under the given name", async () => {
    stubCanvas();
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Download PNG" }));

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("share-link-abc.png");
    expect(saved[0].blob.type).toBe("image/png");
    expect(toast.success).toHaveBeenCalledWith("QR code downloaded");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("copies the PNG to the clipboard and says so", async () => {
    stubCanvas();
    const written: Record<string, unknown>[] = [];
    class FakeClipboardItem {
      constructor(readonly types: Record<string, unknown>) {
        written.push(types);
      }
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      await Promise.all(Object.values(items[0].types));
    });

    try {
      const user = await open();
      Object.defineProperty(navigator, "clipboard", {
        value: { write },
        configurable: true,
      });
      await user.click(screen.getByRole("button", { name: "Copy image" }));

      expect(write).toHaveBeenCalledTimes(1);
      const png = await (written[0]["image/png"] as Promise<Blob>);
      expect(png.type).toBe("image/png");
      expect(toast.success).toHaveBeenCalledWith("QR code copied to clipboard");
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("hands the clipboard a promise, keeping the click's user activation", async () => {
    // WebKit requires `clipboard.write` in the same task as the gesture, so
    // the blob must NOT be awaited first — hence `ClipboardItem`'s promise
    // form. Awaiting it would skip the write entirely here (no canvas in
    // jsdom), which is what makes `write` being called the assertion.
    const written: Record<string, unknown>[] = [];
    class FakeClipboardItem {
      constructor(readonly types: Record<string, unknown>) {
        written.push(types);
      }
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      await Promise.all(Object.values(items[0].types));
    });

    try {
      const user = await open();
      // After `open()`: userEvent.setup() installs a clipboard stub of its
      // own, so defining ours first would be overwritten.
      Object.defineProperty(navigator, "clipboard", {
        value: { write },
        configurable: true,
      });
      await user.click(screen.getByRole("button", { name: "Copy image" }));

      expect(write).toHaveBeenCalledTimes(1);
      expect(written).toHaveLength(1);
      const png = written[0]["image/png"] as PromiseLike<Blob>;
      expect(typeof png?.then).toBe("function");
      // jsdom renders no PNG, so that promise rejects and the write fails.
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("reports, rather than throws, when no PNG can be rendered", async () => {
    // jsdom has no canvas, which is the same path as a browser refusing one.
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(saved).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Copy image" }));
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
