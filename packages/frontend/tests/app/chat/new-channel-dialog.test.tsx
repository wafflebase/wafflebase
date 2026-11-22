import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/api/chat";
import { NewChannelDialog } from "@/app/chat/new-channel-dialog";

const join = vi.fn();
vi.mock("@/components/chat/use-chat", () => ({
  useCreateChannel: () => ({ mutate: vi.fn(), isPending: false }),
  useJoinChannel: () => ({ mutate: join, isPending: false }),
}));

const channel = (id: string, over: Partial<ChannelSummary> = {}) =>
  ({
    id,
    kind: "public",
    name: id,
    topic: null,
    archived: false,
    isDefault: false,
    isMember: false,
    canManage: false,
    members: [],
    lastSeq: 0,
    lastReadSeq: 0,
    unreadCount: 0,
    mentionCount: 0,
    lastMessageAt: null,
    ...over,
  }) satisfies ChannelSummary;

function openBrowse(channels: ChannelSummary[], onOpened = vi.fn()) {
  render(
    <NewChannelDialog
      workspaceId="w1"
      channels={channels}
      open
      tab="browse"
      onTabChange={() => {}}
      onOpenChange={() => {}}
      onOpened={onOpened}
    />,
  );
  return onOpened;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("NewChannelDialog browse", () => {
  it("hides archived channels until asked", async () => {
    openBrowse([channel("live"), channel("old", { archived: true })]);
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.queryByText("old")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: /show archived/i }),
    );
    const row = screen.getByText("old").closest("li")!;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
  });

  it("opens an archived channel read-only, with no Join", async () => {
    const onOpened = openBrowse([channel("old", { archived: true })]);
    await userEvent.click(
      screen.getByRole("checkbox", { name: /show archived/i }),
    );
    const row = screen.getByText("old").closest("li")!;
    expect(
      within(row).queryByRole("button", { name: "Join" }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Open" }));
    expect(onOpened).toHaveBeenCalledWith("old");
  });

  it("offers no toggle when nothing is archived", () => {
    openBrowse([channel("live")]);
    expect(
      screen.queryByRole("checkbox", { name: /show archived/i }),
    ).not.toBeInTheDocument();
  });

  it("does not count archived channels in the Browse tab", () => {
    openBrowse([channel("live"), channel("old", { archived: true })]);
    expect(screen.getByRole("tab", { name: "Browse (1)" })).toBeInTheDocument();
  });

  it("still reaches archived channels when every live one is joined", async () => {
    openBrowse([channel("old", { archived: true })]);
    expect(
      screen.getByText("You're in every public channel here."),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("checkbox", { name: /show archived/i }),
    );
    expect(screen.getByText("old")).toBeInTheDocument();
  });
});

describe("NewChannelDialog title", () => {
  it("names the tab it is open on", () => {
    const { rerender } = render(
      <NewChannelDialog
        workspaceId="w1"
        channels={[]}
        open
        tab="create"
        onTabChange={() => {}}
        onOpenChange={() => {}}
        onOpened={() => {}}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Create a channel" }),
    ).toBeInTheDocument();

    rerender(
      <NewChannelDialog
        workspaceId="w1"
        channels={[]}
        open
        tab="browse"
        onTabChange={() => {}}
        onOpenChange={() => {}}
        onOpened={() => {}}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Browse channels" }),
    ).toBeInTheDocument();
  });
});
