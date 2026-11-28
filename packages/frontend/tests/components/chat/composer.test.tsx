import { act, fireEvent, render, screen } from "@testing-library/react";
import { startTransition, Suspense, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "@/components/chat/composer";

afterEach(() => {
  window.sessionStorage.clear();
});

const box = () => screen.getByRole("textbox", { name: /message/i });
// With members to mention, the box is a combobox over the suggestion list.
const combo = () => screen.getByRole("combobox", { name: /message/i });

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}

describe("Composer", () => {
  it("sends the trimmed body on Enter and clears", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Composer channelId="c1" onSend={onSend} placeholder="Message #general" />);
    type("  hello  ");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello");
    await vi.waitFor(() => expect(box()).toHaveValue(""));
  });

  it("clears at once and keeps text typed while a send is in flight", async () => {
    let resolve!: () => void;
    const onSend = vi.fn(
      () => new Promise<void>((r) => (resolve = r)),
    );
    render(<Composer channelId="c1" onSend={onSend} />);
    type("first");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("first");
    expect(box()).toHaveValue("");
    expect(window.sessionStorage.length).toBe(0);
    type("second thought");
    resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(box()).toHaveValue("second thought");
  });

  it("shows Send as primary only when there is something to send", () => {
    render(<Composer channelId="c1" onSend={vi.fn()} />);
    const send = screen.getByRole("button", { name: /send message/i });
    expect(send).not.toHaveClass("bg-primary");
    type("hello");
    expect(send).toHaveClass("bg-primary");
  });

  it("does not send on Shift+Enter, which is a newline", () => {
    const onSend = vi.fn();
    render(<Composer channelId="c1" onSend={onSend} />);
    type("hello");
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while an IME is composing", () => {
    const onSend = vi.fn();
    render(<Composer channelId="c1" onSend={onSend} />);
    type("안녕");
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    // Some browsers report composition only through keyCode 229.
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    fireEvent.compositionStart(box());
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(box());
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("안녕");
  });

  it("does not send a blank body", () => {
    const onSend = vi.fn();
    render(<Composer channelId="c1" onSend={onSend} />);
    type("   ");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("restores the draft on remount", () => {
    const first = render(
      <Composer channelId="c1" userId={1} onSend={vi.fn()} />,
    );
    type("half a thought");
    first.unmount();
    render(<Composer channelId="c1" userId={1} onSend={vi.fn()} />);
    expect(box()).toHaveValue("half a thought");
  });

  it("keeps drafts apart per channel", () => {
    const first = render(
      <Composer channelId="c1" userId={1} onSend={vi.fn()} />,
    );
    type("for c1");
    first.unmount();
    render(<Composer channelId="c2" userId={1} onSend={vi.fn()} />);
    expect(box()).toHaveValue("");
  });

  it("never shows one user's draft to another in the same tab", () => {
    const first = render(
      <Composer channelId="c1" userId={1} onSend={vi.fn()} />,
    );
    type("private thought");
    first.unmount();
    const second = render(
      <Composer channelId="c1" userId={2} onSend={vi.fn()} />,
    );
    expect(box()).toHaveValue("");
    // The user resolving after the first render loads their own draft.
    second.rerender(<Composer channelId="c1" userId={1} onSend={vi.fn()} />);
    expect(box()).toHaveValue("private thought");
  });

  it("keeps text typed before the signed-in user resolves", () => {
    window.sessionStorage.setItem(
      "wafflebase:chat-draft:1:c1",
      "an older draft",
    );
    const view = render(<Composer channelId="c1" onSend={vi.fn()} />);
    type("typed while loading");
    view.rerender(<Composer channelId="c1" userId={1} onSend={vi.fn()} />);
    expect(box()).toHaveValue("typed while loading");
    // And it is now the user's draft, so it survives a remount.
    view.unmount();
    render(<Composer channelId="c1" userId={1} onSend={vi.fn()} />);
    expect(box()).toHaveValue("typed while loading");
  });

  it("touches storage only after a render commits, never while rendering", () => {
    // A server render runs the render body and no effects: what it wrote
    // is what a discarded render would have written.
    window.sessionStorage.setItem("wafflebase:chat-draft:c1", "legacy");
    window.sessionStorage.setItem("wafflebase:chat-draft:1:c1", "saved");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    try {
      const html = renderToString(
        <Composer channelId="c1" userId={1} onSend={vi.fn()} />,
      );
      expect(html).toContain("saved");
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      removeItem.mockRestore();
    }
    // Mounted for real, the old unkeyed draft is dropped.
    render(<Composer channelId="c1" userId={1} onSend={vi.fn()} />);
    expect(window.sessionStorage.getItem("wafflebase:chat-draft:c1")).toBeNull();
    expect(box()).toHaveValue("saved");
  });

  it("keeps picked mentions when a render switching drafts is discarded", async () => {
    // A transition that suspends throws its render away: the box stays on
    // c1, so the mention picked there must still expand when it is sent.
    const onSend = vi.fn().mockResolvedValue(undefined);
    const never = new Promise<never>(() => undefined);
    let switchTo!: (channelId: string) => void;
    function Suspends({ when }: { when: boolean }): null {
      if (when) throw never;
      return null;
    }
    function Host() {
      const [channelId, setChannelId] = useState("c1");
      switchTo = (next) => startTransition(() => setChannelId(next));
      return (
        <Suspense fallback={null}>
          <Composer
            channelId={channelId}
            userId={1}
            onSend={onSend}
            members={[{ userId: "2", username: "minji" }]}
          />
          <Suspends when={channelId !== "c1"} />
        </Suspense>
      );
    }
    render(<Host />);
    fireEvent.change(combo(), {
      target: { value: "hi @min", selectionStart: 7 },
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /minji/ }));
    await act(async () => switchTo("c2"));
    expect(combo()).toHaveValue("hi @minji ");
    // Typing on renders afresh, reading the picked mentions again.
    fireEvent.change(combo(), {
      target: { value: "hi @minji !", selectionStart: 11 },
    });
    fireEvent.keyDown(combo(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi @[minji](2) !");
  });

  it("loads the stored draft when the user resolves on an empty box", () => {
    window.sessionStorage.setItem("wafflebase:chat-draft:1:c1", "saved");
    const view = render(<Composer channelId="c1" onSend={vi.fn()} />);
    view.rerender(<Composer channelId="c1" userId={1} onSend={vi.fn()} />);
    expect(box()).toHaveValue("saved");
  });

  describe("autoFocus", () => {
    const atEnd = () => {
      const ta = box() as HTMLTextAreaElement;
      return ta.selectionStart === ta.value.length &&
        ta.selectionEnd === ta.value.length;
    };

    it("puts the caret after a restored draft", () => {
      window.sessionStorage.setItem("wafflebase:chat-draft:1:c1", "half a thought");
      render(<Composer channelId="c1" userId={1} onSend={vi.fn()} autoFocus />);
      expect(box()).toHaveFocus();
      expect(box()).toHaveValue("half a thought");
      expect(atEnd()).toBe(true);
    });

    it("puts the caret after a draft that loads once the user resolves", () => {
      window.sessionStorage.setItem("wafflebase:chat-draft:1:c1", "saved");
      const view = render(<Composer channelId="c1" onSend={vi.fn()} autoFocus />);
      (box() as HTMLTextAreaElement).setSelectionRange(0, 0);
      view.rerender(
        <Composer channelId="c1" userId={1} onSend={vi.fn()} autoFocus />,
      );
      expect(box()).toHaveValue("saved");
      expect(atEnd()).toBe(true);
    });
  });

  it("measures the limit after picked mentions expand", async () => {
    render(
      <Composer
        channelId="c1"
        onSend={vi.fn()}
        members={[{ userId: "123456", username: "minji" }]}
      />,
    );
    // `@minji` (6) becomes `@[minji](123456)` (16) on send.
    const prefix = "x".repeat(4000 - 7);
    fireEvent.change(combo(), {
      target: { value: `${prefix} @min`, selectionStart: prefix.length + 5 },
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /minji/ }));
    // As typed it is exactly the limit; as sent it is ten over.
    expect(screen.getByText(/characters over the/)).toHaveTextContent(
      "10 characters over the",
    );
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("is disabled with its reason", () => {
    render(
      <Composer
        channelId="c1"
        onSend={vi.fn()}
        disabledReason="This channel is archived."
      />,
    );
    expect(box()).toBeDisabled();
    expect(screen.getByText("This channel is archived.")).toBeInTheDocument();
  });

  it("tokenizes a picked mention on send", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <Composer
        channelId="c1"
        onSend={onSend}
        members={[{ userId: "2", username: "minji" }]}
      />,
    );
    fireEvent.change(combo(), {
      target: { value: "hi @min", selectionStart: 7 },
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /minji/ }));
    fireEvent.keyDown(combo(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi @[minji](2)");
  });

  it("never hands a sent message back; the caller owns failure", async () => {
    let done!: () => void;
    const onSend = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<Composer channelId="c1" onSend={onSend} />);
    type("gone");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("");
    expect(window.sessionStorage.length).toBe(0);
    done();
    await vi.waitFor(() => expect(box()).toHaveValue(""));
  });

  describe("ArrowUp in an empty box", () => {
    it("asks to edit the last message", () => {
      const onArrowUp = vi.fn();
      render(
        <Composer channelId="c1" onSend={vi.fn()} onArrowUpWhenEmpty={onArrowUp} />,
      );
      const notPrevented = fireEvent.keyDown(box(), { key: "ArrowUp" });
      expect(onArrowUp).toHaveBeenCalledTimes(1);
      expect(notPrevented).toBe(false);
    });

    it("leaves ArrowUp alone with text, a modifier, or an IME composition", () => {
      const onArrowUp = vi.fn();
      render(
        <Composer channelId="c1" onSend={vi.fn()} onArrowUpWhenEmpty={onArrowUp} />,
      );
      fireEvent.keyDown(box(), { key: "ArrowUp", shiftKey: true });
      fireEvent.keyDown(box(), { key: "ArrowUp", metaKey: true });
      fireEvent.keyDown(box(), { key: "ArrowUp", isComposing: true });
      type("x");
      fireEvent.keyDown(box(), { key: "ArrowUp" });
      expect(onArrowUp).not.toHaveBeenCalled();
    });

    it("moves through mention suggestions instead while the list is open", async () => {
      const onArrowUp = vi.fn();
      render(
        <Composer
          channelId="c1"
          onSend={vi.fn()}
          members={[{ userId: "2", username: "minji" }]}
          onArrowUpWhenEmpty={onArrowUp}
        />,
      );
      fireEvent.change(combo(), { target: { value: "@", selectionStart: 1 } });
      await screen.findByRole("listbox");
      fireEvent.keyDown(combo(), { key: "ArrowUp" });
      expect(onArrowUp).not.toHaveBeenCalled();
    });
  });

  describe("keyboard hint", () => {
    const hint = () => screen.getByText(/Enter to send · Shift\+Enter for new line/);

    it("shows only while focused with something typed", () => {
      render(<Composer channelId="c1" onSend={vi.fn()} />);
      expect(hint()).toHaveClass("invisible");
      fireEvent.focus(box());
      expect(hint()).toHaveClass("invisible");
      type("hello");
      expect(hint()).not.toHaveClass("invisible");
      fireEvent.blur(box());
      expect(hint()).toHaveClass("invisible");
    });

    it("is hidden on a coarse pointer", () => {
      render(<Composer channelId="c1" onSend={vi.fn()} />);
      expect(hint()).toHaveClass("pointer-coarse:hidden");
    });
  });
});
