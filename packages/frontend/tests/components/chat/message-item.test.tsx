import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@/api/chat";
import { MessageGroupView } from "@/components/chat/message-item";

vi.mock("@/components/chat/use-chat", () => ({
  useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

const msg = (over: Partial<ChatMessageDto> = {}): ChatMessageDto => ({
  id: "m1",
  channelId: "c1",
  seq: 1,
  author: { id: 1, username: "hackerwins", photo: null },
  body: "Q4 planning starts Monday",
  threadRootId: null,
  alsoInChannel: false,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deleted: false,
  createdAt: "2026-11-20T10:00:00.000Z",
  ...over,
});

function setPointer(coarse: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: coarse && query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderLine(message: ChatMessageDto, me = 1) {
  const onOpenThread = vi.fn();
  render(
    <ol>
      <MessageGroupView
        group={{ author: message.author, first: message, rest: [] }}
        workspaceId="w1"
        me={me}
        onOpenThread={onOpenThread}
      />
    </ol>,
  );
  return { onOpenThread, line: document.getElementById(`chat-message-${message.id}`)! };
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
});

describe("MessageLine on a fine pointer", () => {
  beforeEach(() => setPointer(false));

  it("keeps the hover actions", () => {
    renderLine(msg());
    expect(screen.getByRole("button", { name: "Reply in thread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Message actions" })).toBeNull();
  });
});

describe("MessageLine on a coarse pointer", () => {
  beforeEach(() => setPointer(true));

  it("renders no per-message hover actions", () => {
    renderLine(msg());
    expect(screen.queryByRole("button", { name: "Reply in thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("opens the actions sheet on a long-press", () => {
    vi.useFakeTimers();
    const { line, onOpenThread } = renderLine(msg());
    fireEvent.touchStart(line, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    vi.useRealTimers();
    const sheet = screen.getByRole("dialog", { name: "Message actions" });
    expect(sheet).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete message" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("m1");
  });

  it("does not swallow a tap inside the sheet a long-press opened", () => {
    vi.useFakeTimers();
    const { line } = renderLine(msg());
    fireEvent.touchStart(line, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.touchEnd(line);
    vi.useRealTimers();
    // The sheet is portalled, but React bubbles its touches through the row.
    const reply = screen.getByRole("button", { name: "Reply in thread" });
    const touch = { clientX: 50, clientY: 50 };
    fireEvent.touchStart(reply, { touches: [touch], changedTouches: [touch] });
    const notPrevented = fireEvent.touchEnd(reply, { changedTouches: [touch] });
    expect(notPrevented).toBe(true);
  });

  it("does not open when the finger moves (a scroll)", () => {
    vi.useFakeTimers();
    const { line } = renderLine(msg());
    fireEvent.touchStart(line, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(line, { touches: [{ clientX: 10, clientY: 60 }] });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers an accessible trigger, without Edit/Delete on others' messages", () => {
    renderLine(msg(), 2);
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(screen.getByRole("dialog", { name: "Message actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply in thread" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete message" })).toBeNull();
  });

  it("Delete asks for confirmation inline", () => {
    renderLine(msg());
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete message" }));
    expect(screen.getByRole("group", { name: "Confirm delete" })).toBeInTheDocument();
  });
});
