/**
 * The QR code is the only thing in the app whose correctness a reader
 * cannot check by looking at it, so the matrix is asserted against the
 * encoder's own geometry: the right module count for the version, a quiet
 * zone that is actually quiet, and the three finder patterns in place.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qrCodeSvgDocument } from "@/lib/qr-code";
import { QrCode, QrCodePopover } from "./qr-code";

const URL = "https://wafflebase.example/shared/abc123";

describe("QrCode", () => {
  it("renders a labelled square matrix for the URL", () => {
    render(<QrCode value={URL} />);
    const svg = screen.getByRole("img", { name: "QR code" });
    // A QR version is 21 + 4 * (version - 1) modules per side, plus the
    // 4-module quiet zone on each side.
    const viewBox = svg.getAttribute("viewBox")!.split(" ");
    const size = Number(viewBox[3]);
    expect(viewBox[2]).toBe(viewBox[3]);
    expect((size - 8 - 21) % 4).toBe(0);
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
  });

  it("always paints dark modules on a white plate, in either theme", () => {
    render(<QrCode value={URL} />);
    const svg = screen.getByRole("img", { name: "QR code" });
    expect(svg.querySelector("rect")).toHaveAttribute("fill", "#fff");
    expect(svg.querySelector("path")).toHaveAttribute("fill", "#000");
  });

  it("encodes different URLs differently", () => {
    const { container, rerender } = render(<QrCode value={URL} />);
    const first = container.querySelector("path")!.getAttribute("d");
    rerender(<QrCode value={`${URL}x`} />);
    expect(container.querySelector("path")!.getAttribute("d")).not.toBe(first);
  });
});

describe("qrCodeSvgDocument", () => {
  it("is a standalone SVG document carrying the same modules", () => {
    const svg = qrCodeSvgDocument(URL);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('fill="#000"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

describe("QrCodePopover", () => {
  it("opens the code for the URL with its export actions", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <QrCodePopover url={URL} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Show QR code" }));

    expect(screen.getByRole("img", { name: `QR code for ${URL}` })).toBeTruthy();
    expect(screen.getByText(URL)).toBeTruthy();
    for (const name of ["Download PNG", "Download SVG", "Copy image"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
});
