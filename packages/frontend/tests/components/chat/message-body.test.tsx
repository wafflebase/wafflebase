import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAnchor } from "@/components/chat/document-link";
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

  it("cuts the router basename off an in-app link before routing it", () => {
    vi.stubEnv("VITE_FRONTEND_BASENAME", "/app/");
    try {
      const url = `${window.location.origin}/app/w/w1/chat/c2`;
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
      fireEvent.click(screen.getByRole("link"));
      expect(screen.getByTestId("where")).toHaveTextContent("/w/w1/chat/c2");
    } finally {
      vi.unstubAllEnvs();
    }
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
      const url = `${window.location.origin}/s/${ID}?at=${encodeAnchor(ref.anchor)}`;
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
        `/s/${ID}?chat=c1&at=${encodeAnchor(ref.anchor)}`,
      );
    });

    it("navigates to the anchor the server stored, not the body's ?at=", () => {
      // The body says one place, the stored (validated) anchor another: the
      // card is labelled from the stored one, so it must go there too.
      const other = encodeAnchor({ ...ref.anchor, tabId: "elsewhere", label: "Other!A1" });
      renderRouted(`${window.location.origin}/s/${ID}?at=${other}`);
      const card = screen.getByRole("link");
      expect(card).toHaveTextContent("Sheet1!C3:E7");
      fireEvent.click(card);
      expect(screen.getByTestId("where")).toHaveTextContent(
        `/s/${ID}?chat=c1&at=${encodeAnchor(ref.anchor)}`,
      );
    });

    it("drops an ?at= the server refused", () => {
      renderRouted(`${window.location.origin}/s/${ID}?at=garbage`, [
        { ...ref, anchor: null },
      ]);
      fireEvent.click(screen.getByRole("link"));
      expect(screen.getByTestId("where").textContent).toBe(`/s/${ID}?chat=c1`);
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

    it("cards only the link whose anchor the server stored when one document is linked twice", () => {
      const at = encodeAnchor(ref.anchor);
      const other = encodeAnchor({ ...ref.anchor, rowId: "r2", label: "Sheet1!A1" });
      const first = `${window.location.origin}/s/${ID}?at=${other}`;
      const second = `${window.location.origin}/s/${ID}?at=${at}`;
      // The server keeps one ref per document — here, the second link's.
      renderRouted(`${first} and ${second}`);
      const [a, b] = screen.getAllByRole("link");
      expect(a).not.toHaveAttribute("data-document-card");
      expect(a).toHaveTextContent(first);
      expect(b).toHaveAttribute("data-document-card", ID);
      fireEvent.click(a);
      expect(screen.getByTestId("where")).toHaveTextContent(
        `/s/${ID}?at=${other}`,
      );
    });

    it("cards the first of two links to one document when both share the anchor", () => {
      const url = `${window.location.origin}/s/${ID}?at=${encodeAnchor(ref.anchor)}`;
      renderRouted(`${url} again ${url}`);
      const [a, b] = screen.getAllByRole("link");
      expect(a).toHaveAttribute("data-document-card", ID);
      expect(b).not.toHaveAttribute("data-document-card");
    });

    it("compares anchors regardless of key order", () => {
      const { label, ...rest } = ref.anchor;
      const reordered = { label, ...rest };
      const url = `${window.location.origin}/s/${ID}?at=${encodeAnchor(ref.anchor)}`;
      renderRouted(`${window.location.origin}/s/${ID} then ${url}`, [
        { ...ref, anchor: reordered },
      ]);
      const [a, b] = screen.getAllByRole("link");
      expect(a).not.toHaveAttribute("data-document-card");
      expect(b).toHaveAttribute("data-document-card", ID);
    });

    it("does not card another origin's link even when the id matches", () => {
      renderRouted(`https://evil.test/s/${ID}`);
      expect(screen.getByRole("link")).not.toHaveAttribute("data-document-card");
    });

    // The path's left boundary used to be a lookbehind; these pin what it
    // decided now that the boundary character is matched and stepped over.
    it.each([
      ["at the start", `/s/${ID} first`, "", " first"],
      ["after a space", `see /s/${ID}`, "see ", ""],
      ["after a newline", `see\n/s/${ID}`, "see\n", ""],
      ["after an open paren", `see (/s/${ID}) here`, "see (", ") here"],
      ["after an angle bracket", `see </s/${ID}>`, "see <", ">"],
    ])("cards a bare path %s, keeping the text around it", (_, body, before, after) => {
      const { container } = renderRouted(body);
      const card = screen.getByRole("link");
      expect(card).toHaveAttribute("data-document-card", ID);
      const p = container.querySelector("p")!;
      expect(p.textContent).toBe(`${before}${card.textContent}${after}`);
    });

    it("cards two bare paths one space apart", () => {
      const ID2 = "1c7a4d3f-9b5e-4a2f-8d8c-3e6f70819203";
      renderRouted(`/s/${ID} /d/${ID2}`, [
        ref,
        { documentId: ID2, type: "doc", title: "Plan", anchor: null },
      ]);
      const cards = screen.getAllByRole("link");
      expect(cards.map((c) => c.getAttribute("data-document-card"))).toEqual([
        ID,
        ID2,
      ]);
    });

    it.each([
      ["glued to a word", `x/s/${ID}`],
      ["inside a longer path", `/a/s/${ID}`],
      ["followed by more id characters", `/s/${ID}0`],
    ])("leaves a bare path %s as text", (_, body) => {
      renderRouted(body);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(body)).toBeInTheDocument();
    });
  });
});
