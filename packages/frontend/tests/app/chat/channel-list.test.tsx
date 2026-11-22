import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/api/chat";
import { ChannelList } from "@/app/chat/channel-list";

const channel = (id: string, over: Partial<ChannelSummary> = {}) =>
  ({
    id,
    kind: "public",
    name: id,
    topic: null,
    archived: false,
    isDefault: false,
    isMember: true,
    canManage: false,
    members: [],
    lastSeq: 0,
    lastReadSeq: 0,
    unreadCount: 0,
    mentionCount: 0,
    lastMessageAt: null,
    ...over,
  }) satisfies ChannelSummary;

function renderList(
  channels: ChannelSummary[],
  {
    workspaceId = "w1",
    activeChannelId = null,
    onBrowse = () => {},
  }: {
    workspaceId?: string;
    activeChannelId?: string | null;
    onBrowse?: () => void;
  } = {},
) {
  return render(
    <MemoryRouter>
      <ChannelList
        workspaceId={workspaceId}
        channels={channels}
        isLoading={false}
        activeChannelId={activeChannelId}
        me={1}
        hrefFor={(id) => `/w/${workspaceId}/chat/${id}`}
        onNewChannel={() => {}}
        onBrowse={onBrowse}
        onNewMessage={() => {}}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ChannelList archived section", () => {
  it("is not rendered when there is nothing archived", () => {
    renderList([channel("general")]);
    expect(
      screen.queryByRole("button", { name: /archived/i }),
    ).not.toBeInTheDocument();
  });

  it("starts collapsed and expands to links to the archived channels", async () => {
    renderList([channel("general"), channel("old", { archived: true })]);
    const toggle = screen.getByRole("button", { name: /archived/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /old/ })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /old/ })).toHaveAttribute(
      "href",
      "/w/w1/chat/old",
    );
  });

  it("leaves archived channels out of Channels", () => {
    renderList([channel("general"), channel("old", { archived: true })]);
    const rooms = screen.getByRole("region", { name: "Channels" });
    expect(rooms).not.toHaveTextContent("old");
  });

  it("remembers the expanded state per workspace", async () => {
    const archived = [channel("old", { archived: true })];
    const { unmount } = renderList(archived);
    await userEvent.click(screen.getByRole("button", { name: /archived/i }));
    unmount();

    const again = renderList(archived);
    expect(screen.getByRole("button", { name: /archived/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    again.unmount();

    renderList(archived, { workspaceId: "w2" });
    expect(screen.getByRole("button", { name: /archived/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("still works when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    renderList([channel("old", { archived: true })]);
    const toggle = screen.getByRole("button", { name: /archived/i });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the open archived channel even when collapsed", () => {
    renderList([channel("old", { archived: true })], {
      activeChannelId: "old",
    });
    expect(screen.getByRole("link", { name: /old/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("draws no unread count on an archived channel", async () => {
    renderList([
      channel("old", { archived: true, unreadCount: 3, mentionCount: 2 }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: /archived/i }));
    const link = screen.getByRole("link", { name: /old/ });
    expect(link).not.toHaveTextContent("2");
    expect(link).not.toHaveTextContent(/unread/);
  });
});

describe("ChannelList section actions", () => {
  it("name their action and grow to a 44px target on a coarse pointer", () => {
    renderList([]);
    for (const name of ["New channel", "New message"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-label", name);
      expect(button.className).toContain("size-7");
      expect(button.className).toContain("pointer-coarse:size-11");
    }
  });
});

describe("ChannelList browse row", () => {
  it("counts the public channels not joined and opens Browse", async () => {
    const onBrowse = vi.fn();
    renderList(
      [
        channel("general"),
        channel("design", { isMember: false }),
        channel("ops", { isMember: false }),
        // Neither archived nor private channels are browsable.
        channel("old", { isMember: false, archived: true }),
        channel("secret", { kind: "private", isMember: false }),
      ],
      { onBrowse },
    );
    const rooms = screen.getByRole("region", { name: "Channels" });
    const row = within(rooms).getByRole("button", {
      name: "Browse channels, 2 not joined",
    });
    await userEvent.click(row);
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it("is not shown when every public channel is joined", () => {
    renderList([channel("general"), channel("old", { isMember: false, archived: true })]);
    expect(
      screen.queryByRole("button", { name: /browse channels/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ChannelList preview row", () => {
  it("shows the open, unjoined channel in Channels while it is open", () => {
    renderList([channel("general"), channel("design", { isMember: false })], {
      activeChannelId: "design",
    });
    const rooms = screen.getByRole("region", { name: "Channels" });
    const link = within(rooms).getByRole("link", { name: /design/ });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveTextContent("not joined");
    expect(within(link).getByText("design")).toHaveClass("italic");
  });

  it("drops it again once another channel is open", () => {
    renderList([channel("general"), channel("design", { isMember: false })], {
      activeChannelId: "general",
    });
    expect(
      screen.queryByRole("link", { name: /design/ }),
    ).not.toBeInTheDocument();
  });
});

describe("ChannelList group DMs", () => {
  const user = (id: number, username: string) => ({ id, username, photo: null });

  it("stacks two avatars for a group DM and one for a 1:1", () => {
    renderList([
      channel("pair", {
        kind: "dm",
        name: null,
        members: [user(1, "me"), user(2, "minji")],
      }),
      channel("group", {
        kind: "dm",
        name: null,
        members: [user(1, "me"), user(2, "minji"), user(3, "jun"), user(4, "ara")],
      }),
    ]);
    const pair = screen.getByRole("link", { name: /^minji$/ });
    const group = screen.getByRole("link", { name: /minji, jun, ara/ });
    const avatars = (el: HTMLElement) =>
      el.querySelectorAll('[data-slot="avatar"]').length;
    expect(avatars(pair)).toBe(1);
    expect(avatars(group)).toBe(2);
  });
});
