import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MemberPicker } from "@/app/chat/member-picker";

const renderPicker = (
  members: { userId: string; username: string }[],
  excluded: string[] = [],
) =>
  render(
    <MemoryRouter>
      <MemberPicker
        members={members}
        selected={[]}
        onChange={() => {}}
        excluded={excluded}
        inviteHref="/w/team/settings"
      />
    </MemoryRouter>,
  );

describe("MemberPicker", () => {
  it("says the caller is alone and where to invite, not 'No one matches'", () => {
    renderPicker([]);

    expect(screen.getByText(/only one in this workspace/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invite people" })).toHaveAttribute(
      "href",
      "/w/team/settings",
    );
    expect(screen.queryByText(/No one matches/)).not.toBeInTheDocument();
  });

  it("shows people already in the channel as unpickable", () => {
    renderPicker(
      [
        { userId: "2", username: "minji" },
        { userId: "3", username: "jiyu" },
      ],
      ["2"],
    );

    const minji = screen.getByRole("checkbox", { name: /minji/ });
    expect(minji).toBeDisabled();
    expect(minji).toHaveTextContent("Already here");
    expect(screen.getByRole("checkbox", { name: /jiyu/ })).toBeEnabled();
  });
});
