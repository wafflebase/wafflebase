import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { useMentionAutocomplete } from "@/components/chat/use-mention-autocomplete";

const MEMBERS = [
  { userId: "1", username: "alice" },
  { userId: "2", username: "alex" },
  { userId: "3", username: "bora" },
];

function Harness({
  onKeyDown,
  onApply,
  members = MEMBERS,
}: {
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onApply?: (body: string) => void;
  members?: typeof MEMBERS;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const m = useMentionAutocomplete({
    textareaRef: ref,
    onChange: setText,
    members,
    onKeyDown,
  });
  return (
    <div className="relative">
      <textarea ref={ref} value={text} aria-label="Body" {...m.inputProps} />
      {m.listbox}
      <button type="button" onClick={() => onApply?.(m.applyMentions(text))}>
        apply
      </button>
    </div>
  );
}

const input = () => screen.getByRole("combobox", { name: "Body" });
const typeAt = (value: string) =>
  fireEvent.change(input(), {
    target: { value, selectionStart: value.length },
  });

describe("useMentionAutocomplete", () => {
  it("is a collapsed combobox with nothing to suggest", () => {
    render(<Harness />);
    expect(input()).toHaveAttribute("aria-autocomplete", "list");
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).not.toHaveAttribute("aria-controls");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
  });

  it("stays a plain textbox when nobody can be mentioned", () => {
    render(<Harness members={[]} />);
    expect(screen.getByRole("textbox", { name: "Body" })).not.toHaveAttribute(
      "aria-expanded",
    );
  });

  it("points the combobox at the open list and its active option", () => {
    render(<Harness />);
    typeAt("hi @al");
    const listbox = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      expect.stringMatching(/alice$/),
      expect.stringMatching(/alex$/),
    ]);
    expect(screen.getByRole("option", { name: "alice" })).toBe(options[0]);
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).toHaveAttribute("aria-controls", listbox.id);
    expect(input()).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("announces the result count politely", () => {
    render(<Harness />);
    typeAt("@al");
    expect(screen.getByText("2 suggestions")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    typeAt("@bo");
    expect(screen.getByText("1 suggestion")).toBeInTheDocument();
  });

  it("wraps ArrowDown / ArrowUp through the options", () => {
    render(<Harness />);
    typeAt("@al");
    const [first, second] = screen.getAllByRole("option");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", second.id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", first.id);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute("aria-activedescendant", second.id);
  });

  it("picks the active option on Enter without passing the key on", () => {
    const onKeyDown = vi.fn();
    const onApply = vi.fn();
    render(<Harness onKeyDown={onKeyDown} onApply={onApply} />);
    typeAt("hi @al");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(input()).toHaveValue("hi @alex ");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    expect(onApply).toHaveBeenCalledWith("hi @[alex](2) ");
  });

  it("picks on Tab too", () => {
    render(<Harness />);
    typeAt("@bo");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(input()).toHaveValue("@bora ");
  });

  it("closes on Escape before anything else sees it", () => {
    const onKeyDown = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness onKeyDown={onKeyDown} />
      </div>,
    );
    typeAt("@al");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    // The next Escape is the consumer's.
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("passes keys on when the list is closed", () => {
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    typeAt("hello");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("swallows keystrokes that belong to an IME composition", () => {
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    fireEvent.compositionStart(input());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("does not open the list mid-composition", () => {
    render(<Harness />);
    fireEvent.compositionStart(input());
    typeAt("@al");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
