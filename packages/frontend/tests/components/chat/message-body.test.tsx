import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("leaves same-origin pages the router does not own to the browser", () => {
    const url = `${window.location.origin}/docs/guide/chat`;
    function Where() {
      const loc = useLocation();
      return <span data-testid="where">{loc.pathname}</span>;
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
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(screen.getByTestId("where")).toHaveTextContent("/start");
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

  describe("document cards", () => {
    const ID = "0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192";
    const ref = {
      documentId: ID,
      type: "sheet",
      title: "Q4 budget",
      anchor: {
        tabId: "t",
        rowId: "r",
        colId: "c",
        rowSpan: 2,
        colSpan: 3,
        label: "Sheet1!C3:E7",
      },
    };
    function Where() {
      const loc = useLocation();
      return <span data-testid="where">{loc.pathname + loc.search}</span>;
    }
    function renderRouted(body: string, refs = [ref]) {
      return render(
        <MemoryRouter initialEntries={["/start"]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <MessageBody body={body} refs={refs} channelId="c1" />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    }

    it("renders a resolved link as a card that opens the document with ?chat=", () => {
      const url = `${window.location.origin}/s/${ID}?at=abc`;
      renderRouted(`look ${url}.`);
      const card = screen.getByRole("link");
      expect(card).toHaveAttribute("data-document-card", ID);
      expect(card).toHaveAttribute("title", url);
      expect(card).toHaveTextContent("Q4 budget");
      expect(card).toHaveTextContent("Sheet1!C3:E7");
      expect(card.querySelector("svg")?.getAttribute("class")).toMatch(
        /text-type-sheet/,
      );
      fireEvent.click(card);
      expect(screen.getByTestId("where")).toHaveTextContent(
        `/s/${ID}?chat=c1&at=abc`,
      );
    });

    it("renders a root-relative path with a ref as a card, and leaves one without as text", () => {
      renderRouted(`/s/${ID}`);
      expect(screen.getByRole("link")).toHaveTextContent("Q4 budget");
      cleanup();
      renderRouted(`/s/${ID}`, []);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(`/s/${ID}`)).toBeInTheDocument();
    });

    it("keeps a document link without a ref a plain link", () => {
      const url = `${window.location.origin}/s/${ID}`;
      renderRouted(url, []);
      const link = screen.getByRole("link");
      expect(link).not.toHaveAttribute("data-document-card");
      expect(link).toHaveTextContent(url);
    });

    it("does not card another origin's link even when the id matches", () => {
      renderRouted(`https://evil.test/s/${ID}`);
      expect(screen.getByRole("link")).not.toHaveAttribute("data-document-card");
    });
  });
});
