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

describe("MessageLine desktop menu", () => {
  beforeEach(() => setPointer(false));

  const openMenu = () => {
    // Radix opens on the full pointer sequence, not a synthetic click.
    const trigger = screen.getByRole("button", { name: "More actions" });
    for (const type of ["pointerdown", "pointerup", "click"]) {
      fireEvent(
        trigger,
        new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
      );
    }
  };

  it("gives others' messages Copy text and Copy link, without Edit/Delete", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderLine(msg(), 2);
    openMenu();
    expect(await screen.findByRole("menuitem", { name: "Copy text" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit message" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link to message" }));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/w/w1/chat/c1?message=m1`,
    );
  });

  it("keeps Edit and Delete on my own", async () => {
    renderLine(msg());
    openMenu();
    expect(await screen.findByRole("menuitem", { name: "Edit message" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete message" })).toBeInTheDocument();
  });

  it("washes a message that mentions me", () => {
    const { line } = renderLine(msg({ body: "ping @[me](2)" }), 2);
    expect(line.className).toMatch(/bg-selected\/40/);
  });

  it("does not wash one that mentions someone else", () => {
    const { line } = renderLine(msg({ body: "ping @[you](3)" }), 2);
    expect(line.className).not.toMatch(/bg-selected/);
  });

  it("keeps a thread link focusable for focus restore", () => {
    renderLine(msg({ replyCount: 2 }));
    expect(document.querySelector("[data-thread-link]")).toHaveTextContent("2 replies");
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

describe("MessageLine tap to select on a coarse pointer", () => {
  beforeEach(() => setPointer(true));

  it("selects the row on a tap, which shows its actions trigger", () => {
    const { line } = renderLine(msg());
    const trigger = screen.getByRole("button", { name: "Message actions" });
    // Not sr-only: a sighted finger has to be able to find it.
    expect(trigger).not.toHaveClass("sr-only");
    expect(trigger).toHaveClass("group-focus-within/message:opacity-100");
    fireEvent.click(line.querySelector("p, span, div")!);
    expect(line).toHaveFocus();
  });

  it("leaves a tap on a control in the row to that control", () => {
    const { line, onOpenThread } = renderLine(msg({ replyCount: 2 }));
    fireEvent.click(screen.getByRole("button", { name: /2 replies/ }));
    expect(onOpenThread).toHaveBeenCalledWith("m1");
    expect(line).not.toHaveFocus();
  });
});

describe("a failed send", () => {
  beforeEach(() => setPointer(false));

  const failed = (failure?: { reason: string | null; retryable: boolean }) =>
    ({
      ...msg({ id: "local-k1" }),
      localState: "failed",
      clientId: "k1",
      failure,
    }) as ChatMessageDto;

  it("offers Retry and Discard when sending again may work", () => {
    renderLine(failed());
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("says why and offers only Discard when the server refused it for good", () => {
    renderLine(
      failed({ reason: "This channel is archived, so it no longer takes messages.", retryable: false }),
    );
    expect(
      screen.getByText("This channel is archived, so it no longer takes messages."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("tells a reader who is sending too fast to slow down, and still offers Retry", () => {
    renderLine(
      failed({
        reason: "You're sending messages too quickly. Wait a moment and try again.",
        retryable: true,
      }),
    );
    expect(screen.getByText(/sending messages too quickly/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("EditBox", () => {
  beforeEach(() => setPointer(false));

  it("measures the limit after picked mentions expand", async () => {
    render(
      <ol>
        <MessageGroupView
          group={{ author: msg().author, first: msg(), rest: [] }}
          workspaceId="w1"
          me={1}
          editingId="m1"
          onEdit={vi.fn()}
          members={[{ userId: "123456", username: "minji" }]}
        />
      </ol>,
    );
    const box = screen.getByRole("combobox", { name: "Edit message" });
    const save = screen.getByRole("button", { name: "Save" });
    // `@minji` (6) becomes `@[minji](123456)` (16) when saved.
    const prefix = "x".repeat(4000 - 7);
    fireEvent.change(box, {
      target: { value: `${prefix} @min`, selectionStart: prefix.length + 5 },
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /minji/ }));
    // As typed it is exactly the limit; as saved it is ten over.
    expect(box).toHaveValue(`${prefix} @minji `);
    expect(save).toBeDisabled();
    expect(box).toHaveAttribute("aria-invalid", "true");

    // Ten characters shorter, it fits as saved.
    fireEvent.change(box, { target: { value: `${prefix.slice(10)} @minji ` } });
    expect(save).toBeEnabled();
  });
});

describe("MessageGroupView header", () => {
  beforeEach(() => setPointer(false));

  it("labels a bot author", () => {
    renderLine(
      msg({ author: { id: 9, username: "helper", photo: null, kind: "bot" } }),
    );
    expect(screen.getByText("helper")).toBeInTheDocument();
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });

  it("does not label a person", () => {
    renderLine(msg());
    expect(screen.queryByText("Bot")).toBeNull();
  });
});
