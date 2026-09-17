import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SheetLinkPopover } from "./SheetLinkPopover";

/**
 * The card is the one place a cell link becomes an `href`, so its protocol
 * gate is load-bearing rather than defensive: the engine's own allowlist runs
 * over the *detected* span, and nothing stops a future caller handing this
 * component a string that never went through it.
 *
 * The rest of what is asserted here is the behavior the card exists for —
 * every link reachable, the destination legible, and a check mark that is not
 * shown when the clipboard write was refused.
 */
const handlers = () => ({
  onPointerEnter: vi.fn(),
  onPointerLeave: vi.fn(),
});

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SheetLinkPopover", () => {
  it("renders one reachable link per URL, in reading order", () => {
    render(
      <SheetLinkPopover
        urls={["https://a.example/one", "https://b.example/two"]}
        {...handlers()}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links.map((each) => each.getAttribute("href"))).toEqual([
      "https://a.example/one",
      "https://b.example/two",
    ]);
    for (const each of links) {
      expect(each).toHaveAttribute("target", "_blank");
      // No opener: the opened tab must not be able to navigate this one.
      expect(each.getAttribute("rel")).toContain("noopener");
      expect(each.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["blob:https://example.com/abc"],
    ["file:///etc/passwd"],
    ["not a url at all"],
  ])("never puts %s into an href", (hostile) => {
    const { container } = render(
      <SheetLinkPopover urls={[hostile]} {...handlers()} />,
    );
    // Nothing safe is left, so the card does not render at all.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the safe links when one of a cell's links is not", () => {
    render(
      <SheetLinkPopover
        urls={["javascript:alert(1)", "https://ok.example/"]}
        {...handlers()}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://ok.example/");
  });

  it("labels a link by host, and an address by the address", () => {
    render(
      <SheetLinkPopover
        urls={["https://www.example.com/", "mailto:someone@example.com"]}
        {...handlers()}
      />,
    );
    // The `www.` and the trailing slash carry nothing a reader needs.
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("someone@example.com")).toBeInTheDocument();
  });

  it("truncates a long path but never the host", () => {
    const url = `https://example.com/${"a".repeat(200)}`;
    render(<SheetLinkPopover urls={[url]} {...handlers()} />);

    const label = screen.getByText(/^example\.com/).textContent ?? "";
    expect(label.startsWith("example.com/")).toBe(true);
    expect(label.length).toBeLessThan(60);
    expect(label.endsWith("…")).toBe(true);
    // The full destination stays available to a reader who wants it.
    expect(screen.getByRole("link")).toHaveAttribute("title", url);
  });

  it("confirms a copy that succeeded", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(
      <SheetLinkPopover urls={["https://a.example/one"]} {...handlers()} />,
    );

    fireEvent.click(screen.getByLabelText("Copy https://a.example/one"));
    expect(writeText).toHaveBeenCalledWith("https://a.example/one");
    expect(await screen.findByTestId("sheet-link-copied")).toBeInTheDocument();
  });

  it("shows no confirmation when the clipboard refused", async () => {
    // An insecure origin, a lost focus, a cross-origin frame. Showing the
    // check mark anyway tells the reader their clipboard holds something it
    // does not.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubClipboard(writeText);
    render(
      <SheetLinkPopover urls={["https://a.example/one"]} {...handlers()} />,
    );

    fireEvent.click(screen.getByLabelText("Copy https://a.example/one"));
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(screen.queryByTestId("sheet-link-copied")).toBeNull();
  });

  it("reports the pointer crossing into and out of the card", () => {
    const h = handlers();
    render(<SheetLinkPopover urls={["https://a.example/"]} {...h} />);

    const card = screen.getByRole("dialog");
    fireEvent.pointerEnter(card);
    expect(h.onPointerEnter).toHaveBeenCalled();
    fireEvent.pointerLeave(card);
    expect(h.onPointerLeave).toHaveBeenCalled();
  });
});
