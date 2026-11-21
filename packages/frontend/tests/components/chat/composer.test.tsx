import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "@/components/chat/composer";

afterEach(() => {
  window.sessionStorage.clear();
});

const box = () => screen.getByRole("textbox", { name: /message/i });

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

  it("keeps text typed while a send is in flight", async () => {
    let resolve!: () => void;
    const onSend = vi.fn(
      () => new Promise<void>((r) => (resolve = r)),
    );
    render(<Composer channelId="c1" onSend={onSend} />);
    type("first");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("first");
    type("first second thought");
    resolve();
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(box()).toHaveValue("first second thought");
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
    const first = render(<Composer channelId="c1" onSend={vi.fn()} />);
    type("half a thought");
    first.unmount();
    render(<Composer channelId="c1" onSend={vi.fn()} />);
    expect(box()).toHaveValue("half a thought");
  });

  it("keeps drafts apart per channel", () => {
    const first = render(<Composer channelId="c1" onSend={vi.fn()} />);
    type("for c1");
    first.unmount();
    render(<Composer channelId="c2" onSend={vi.fn()} />);
    expect(box()).toHaveValue("");
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
    const el = box() as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: "hi @min", selectionStart: 7 } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /minji/ }));
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi @[minji](2)");
  });

  it("keeps the text when sending fails", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("nope"));
    render(<Composer channelId="c1" onSend={onSend} />);
    type("keep me");
    fireEvent.keyDown(box(), { key: "Enter" });
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(box()).toHaveValue("keep me");
  });
});
