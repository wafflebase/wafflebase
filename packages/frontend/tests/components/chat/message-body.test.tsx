import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MessageBody } from "@/components/chat/message-body";

describe("MessageBody", () => {
  it("renders a mention token as a chip", () => {
    render(<MessageBody body="hi @[minji](2) there" />);
    const chip = screen.getByText("@minji");
    expect(chip).toHaveAttribute("data-mention-user-id", "2");
  });

  it("links a bare URL without its trailing punctuation", () => {
    render(<MessageBody body="see https://example.test/a." />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.test/a");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.parentElement).toHaveTextContent("see https://example.test/a.");
  });

  it("renders markup as text", () => {
    const { container } = render(<MessageBody body="<b>bold</b>" />);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
  });

  it("does not link a javascript: URL", () => {
    render(<MessageBody body="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("draws an ordinary mention as a neutral chip and mine as selected", () => {
    render(<MessageBody body="@[minji](2) and @[me](7)" me={7} />);
    expect(screen.getByText("@minji").className).toMatch(/bg-muted/);
    expect(screen.getByText("@minji").className).not.toMatch(/primary/);
    expect(screen.getByText("@me").className).toMatch(/bg-selected/);
    expect(screen.getByText("@me")).toHaveAttribute("data-mention-self", "true");
  });

  it("opens this app's own links in place through the router", () => {
    const url = `${window.location.origin}/w/w1/chat/c2?message=m9`;
    function Where() {
      const loc = useLocation();
      return <span data-testid="where">{loc.pathname + loc.search}</span>;
    }
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="*" element={<><MessageBody body={`see ${url}`} /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link).not.toHaveAttribute("target");
    fireEvent.click(link);
    expect(screen.getByTestId("where")).toHaveTextContent("/w/w1/chat/c2?message=m9");
  });

  it("keeps a link out of the tab order when asked", () => {
    render(<MessageBody body="https://example.test" tabbable={false} />);
    expect(screen.getByRole("link")).toHaveAttribute("tabindex", "-1");
  });

  describe("long bodies", () => {
    const saved = {
      scroll: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
      client: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
    };
    afterEach(() => {
      if (saved.scroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", saved.scroll);
      if (saved.client) Object.defineProperty(HTMLElement.prototype, "clientHeight", saved.client);
    });

    it("collapses past twelve lines behind Show more", () => {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: () => 600,
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => 240,
      });
      const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
      const { container } = render(<MessageBody body={body} />);
      const p = container.querySelector("p")!;
      expect(p.className).toMatch(/line-clamp-12/);
      const more = screen.getByRole("button", { name: "Show more" });
      expect(more).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(more);
      expect(p.className).not.toMatch(/line-clamp/);
      expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    });

    it("leaves a short body alone", () => {
      render(<MessageBody body="short" />);
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });
  });
});
