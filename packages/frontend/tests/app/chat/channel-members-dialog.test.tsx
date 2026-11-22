import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelMember, ChannelSummary } from "@/api/chat";
import {
  ChannelMembersButton,
  ChannelMembersDialog,
} from "@/app/chat/channel-members-dialog";

const fetchMembersSpy =
  vi.fn<(w: string, c: string) => Promise<ChannelMember[]>>();
const removeSpy = vi.fn<(w: string, c: string, u: number) => Promise<void>>();

vi.mock("@/api/chat", () => ({
  fetchChannelMembers: (w: string, c: string) => fetchMembersSpy(w, c),
  removeChannelMember: (w: string, c: string, u: number) => removeSpy(w, c, u),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const channel = (over: Partial<ChannelSummary> = {}) =>
  ({
    id: "c1",
    kind: "public",
    name: "room",
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

const people: ChannelMember[] = [
  { id: 1, username: "me", photo: null, canRemove: false },
  { id: 2, username: "minji", photo: null, canRemove: false },
];
/** The same list as the server answers it to someone who may remove minji. */
const removable = people.map((p) => ({ ...p, canRemove: p.id === 2 }));

function renderDialog(
  c: ChannelSummary,
  onAddPeople = vi.fn(),
  onOpenChange = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelMembersDialog
        workspaceId="w1"
        channel={c}
        meId={1}
        open
        onOpenChange={onOpenChange}
        onAddPeople={onAddPeople}
      />
    </QueryClientProvider>,
  );
  return { onAddPeople, onOpenChange };
}

beforeEach(() => {
  fetchMembersSpy.mockResolvedValue(people);
  removeSpy.mockResolvedValue();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChannelMembersDialog", () => {
  it("lists members and marks the caller", async () => {
    renderDialog(channel());

    const list = await screen.findByRole("list", { name: "Channel members" });
    expect(within(list).getByText("minji")).toBeInTheDocument();
    expect(within(list).getByText("(you)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("offers Remove only where the server allows it, not wherever the caller manages", async () => {
    // Any member of a private channel may archive it, but removing people is
    // the creator's or an owner's: the rows say no, so no Remove appears.
    renderDialog(channel({ kind: "private", canManage: true }));
    await screen.findByRole("list", { name: "Channel members" });
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("offers Remove for others only, and confirms before removing", async () => {
    const user = userEvent.setup();
    fetchMembersSpy.mockResolvedValue(removable);
    renderDialog(channel({ canManage: true }));

    const remove = await screen.findByRole("button", {
      name: "Remove minji",
    });
    expect(screen.queryByRole("button", { name: "Remove me" })).toBeNull();

    await user.click(remove);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove minji from #room\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("w1", "c1", 2));
  });

  it("backs out of a removal on Cancel", async () => {
    const user = userEvent.setup();
    fetchMembersSpy.mockResolvedValue(removable);
    renderDialog(channel({ canManage: true }));

    await user.click(
      await screen.findByRole("button", { name: "Remove minji" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove minji" }),
    ).toBeInTheDocument();
  });

  it("hands Add people to the page and closes", async () => {
    const user = userEvent.setup();
    const { onAddPeople, onOpenChange } = renderDialog(channel());

    await user.click(await screen.findByRole("button", { name: "Add people" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAddPeople).toHaveBeenCalled();
  });

  it("offers no Add people where nobody can be invited", async () => {
    renderDialog(channel({ isDefault: true, canManage: true }));

    await screen.findByRole("list", { name: "Channel members" });
    expect(screen.queryByRole("button", { name: "Add people" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("reports a failed load", async () => {
    fetchMembersSpy.mockRejectedValue(new Error("nope"));
    renderDialog(channel());

    expect(
      await screen.findByText(/Couldn't load the members/),
    ).toBeInTheDocument();
  });
});

describe("ChannelMembersButton", () => {
  it("shows the member count once loaded", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChannelMembersButton
          workspaceId="w1"
          channelId="c1"
          onClick={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Members: 2" }),
    ).toHaveTextContent("2");
  });
});
