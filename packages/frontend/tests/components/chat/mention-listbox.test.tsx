import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MentionListbox } from "@/components/chat/mention-listbox";

describe("MentionListbox", () => {
  it("labels bot members in the suggestions", () => {
    render(
      <MentionListbox
        id="mentions"
        optionId={(i) => `mention-${i}`}
        open
        activeIndex={0}
        onPick={vi.fn()}
        members={[
          { userId: "1", username: "minji" },
          { userId: "9", username: "helper", kind: "bot" },
        ]}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(within(options[0]).queryByText("Bot")).toBeNull();
    expect(within(options[1]).getByText("Bot")).toBeInTheDocument();
  });
});
