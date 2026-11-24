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
import { encodeQr, qrCodeSvgDocument, type QrMatrix } from "@/lib/qr-code";
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
