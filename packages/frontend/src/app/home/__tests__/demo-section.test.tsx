import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/api/http-error";

const resolveShareLink = vi.fn();

vi.mock("@/api/share-links", () => ({
  resolveShareLink: (token: string) => resolveShareLink(token),
}));
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

const { DemoSection } = await import("../demo-section");

beforeEach(() => {
  resolveShareLink.mockReset();
});

describe("DemoSection", () => {
  // The demo sits right under the hero: appearing only after the check
  // resolved pushed every later section down on wafflebase.io, where the
  // check always succeeds. It holds its place while checking instead.
  it("renders the demo while the demo documents are being checked", () => {
    resolveShareLink.mockReturnValue(new Promise(() => {}));
    render(<DemoSection />);
    expect(screen.getByText("Try it live")).toBeInTheDocument();
  });

  it("renders the live demo once every demo document resolves", async () => {
    resolveShareLink.mockResolvedValue({ documentId: "d", role: "viewer" });
    render(<DemoSection />);
    expect(await screen.findByText("Try it live")).toBeInTheDocument();
    expect(screen.getByTitle("Wafflebase live demo spreadsheet")).toBeTruthy();
    expect(resolveShareLink).toHaveBeenCalledTimes(3);
  });

  // A self-hosted install has none of wafflebase.io's demo documents, and the
  // frame used to open on "Share link not found" instead.
  it("hides the whole section when a demo document does not resolve", async () => {
    resolveShareLink
      .mockResolvedValueOnce({ documentId: "d", role: "viewer" })
      .mockRejectedValueOnce(new HttpError("Share link not found", 404))
      .mockResolvedValueOnce({ documentId: "d", role: "viewer" });
    const { container } = render(<DemoSection />);
    await waitFor(() => expect(resolveShareLink).toHaveBeenCalledTimes(3));
    // Let the rejection settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Try it live")).toBeNull();
  });
});
