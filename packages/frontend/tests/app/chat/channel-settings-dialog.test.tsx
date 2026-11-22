import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/api/chat";
import { ChannelSettingsDialog } from "@/app/chat/channel-settings-dialog";

const mutate = vi.fn();
vi.mock("@/components/chat/use-chat", () => ({
  useUpdateChannel: () => ({ mutate, isPending: false }),
}));

const channel: ChannelSummary = {
  id: "c1",
  kind: "public",
  name: "general",
  topic: "Everything",
  archived: false,
  isDefault: false,
  isMember: true,
  canManage: true,
  members: [],
  lastSeq: 0,
  lastReadSeq: 0,
  unreadCount: 0,
  mentionCount: 0,
  lastMessageAt: null,
};

function open(mode: "rename" | "topic" | "archive") {
  render(
    <ChannelSettingsDialog
      workspaceId="w1"
      channel={channel}
      mode={mode}
      onClose={() => {}}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChannelSettingsDialog", () => {
  it("validates a new name like the create dialog does", async () => {
    const user = userEvent.setup();
    open("rename");
    const input = screen.getByLabelText("Name");
    const submit = screen.getByRole("button", { name: "Rename" });

    // Unchanged is not a rename.
    expect(submit).toBeDisabled();

    await user.clear(input);
    await user.type(input, "-bad");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/Use letters, numbers, - and _/),
    ).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(input);
    await user.type(input, "Q4 Planning");
    expect(screen.getByText("Will be renamed as #q4-planning")).toBeVisible();
    await user.click(submit);
    expect(mutate).toHaveBeenCalledWith(
      { channelId: "c1", name: "q4-planning" },
      expect.anything(),
    );
  });

  it("clears the topic with an empty string", async () => {
    const user = userEvent.setup();
    open("topic");
    await user.clear(screen.getByLabelText("Topic"));
    await user.click(screen.getByRole("button", { name: "Save topic" }));
    expect(mutate).toHaveBeenCalledWith(
      { channelId: "c1", topic: "" },
      expect.anything(),
    );
  });

  it("archives only from its own confirm button", async () => {
    const user = userEvent.setup();
    open("archive");
    expect(mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Archive channel" }));
    expect(mutate).toHaveBeenCalledWith(
      { channelId: "c1", archived: true },
      expect.anything(),
    );
  });

  it("says where an archived channel goes", () => {
    open("archive");
    expect(
      screen.getByText(/It moves to Archived in the channel list/),
    ).toBeInTheDocument();
  });
});
