import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
