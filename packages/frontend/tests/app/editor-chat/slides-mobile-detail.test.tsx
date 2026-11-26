import { vi } from "vitest";

const doc = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@yorkie-js/react", async () =>
  (await import("./harness")).yorkieMock(() => doc.current),
);
vi.mock("@/api/auth", async () => (await import("./harness")).authMock);
vi.mock("@/api/workspaces", async () => (await import("./harness")).workspacesMock);
vi.mock("@/api/documents", async () =>
  (await import("./harness")).documentsMock("slides"),
);
vi.mock("@/components/site-header", async () =>
  (await import("./harness")).siteHeaderMock,
);
vi.mock("@/components/chat/chat-panel-slot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/chat/chat-panel-slot")>()),
  LazyChatPanel: (await import("./harness")).ChatPanelMarker,
}));
vi.mock("@/components/history/history-panel-lazy", async () => ({
  LazyHistoryPanel: (await import("./harness")).MockHistoryPanel,
}));
vi.mock("@/components/history/revision-preview", async () => ({
  RevisionPreviewOverlay: (await import("./harness")).MockRevisionOverlay,
}));
vi.mock("@/hooks/use-presence-updater", () => ({ usePresenceUpdater: () => undefined }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/user-presence", () => ({ UserPresence: () => null }));
vi.mock("@/hooks/use-auto-collapse-sidebar", () => ({
  useAutoCollapseSidebar: () => ({ open: true, onOpenChange: () => undefined }),
}));
vi.mock("@/app/slides/slides-view", () => ({ SlidesView: () => null }));
// The canvas hands the layout a store, so the design sheets it gates on one
// can open.
vi.mock("@/app/slides/mobile-slides-view", async () => {
  const { useEffect } = await import("react");
  const store = {
    getSlideCount: () => 1,
    onChange: () => () => undefined,
    read: () => ({ meta: { themeId: "t1" }, themes: [], slides: [] }),
  };
  return {
    MobileSlidesView: ({
      onStoreReady,
    }: {
      onStoreReady: (s: typeof store) => void;
    }) => {
      useEffect(() => onStoreReady(store), [onStoreReady]);
      return null;
    },
  };
});
// The toolbar's Theme button, which opens a design bottom sheet.
vi.mock("@/app/slides/toolbar", () => ({
  SlidesToolbar: ({
    onToggleThemePanel,
    themePanelOpen,
  }: {
    onToggleThemePanel: () => void;
    themePanelOpen: boolean;
  }) => (
    <button aria-pressed={themePanelOpen} onClick={onToggleThemePanel}>
      {themePanelOpen ? "Hide theme" : "Show theme"}
    </button>
  ),
}));
vi.mock("@/app/slides/slides-presentation-mode", () => ({
  SlidesPresentationMode: () => null,
}));
vi.mock("@/app/slides/slides-present-button", () => ({ PresentButton: () => null }));
vi.mock("@/app/slides/slides-export-button", () => ({
  SlidesExportButton: () => null,
}));
vi.mock("@/app/slides/theme-panel", () => ({
  ThemePanel: () => <div data-testid="theme-panel" />,
}));
vi.mock("@/app/slides/format-panel", () => ({ FormatPanel: () => null }));
vi.mock("@/app/slides/motion-panel", () => ({ MotionPanel: () => null }));
vi.mock("@/app/slides/background-side-panel", () => ({
  BackgroundSidePanel: () => null,
}));

import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SlidesDetail } from "@/app/slides/slides-detail";
import { describeEditorChatPanel, fakeDoc, renderEditor } from "./harness";

doc.current = fakeDoc();

// The phone layout is a second implementation of the slot: chat shares the
// bottom of the screen with the design sheets, one at a time. It wires no
// version history, so there is no revision preview to withhold chat behind.
describeEditorChatPanel("slides (mobile)", {
  route: "/p/:id",
  documentId: "deck-1",
  element: () => <SlidesDetail />,
  preview: false,
});

describe("slides (mobile) chat panel sheet", () => {
  it("opens chat without an empty design sheet over it", async () => {
    renderEditor({ route: "/p/:id", url: "/p/deck-1", element: <SlidesDetail /> });
    await userEvent.click(
      await screen.findByRole("button", { name: "Show chat" }),
    );
    await screen.findByTestId("chat-panel");
    // The design sheet is a dialog; chat draws its own surface.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives the bottom of the screen to one of chat and a design sheet", async () => {
    renderEditor({ route: "/p/:id", url: "/p/deck-1", element: <SlidesDetail /> });
    await userEvent.click(
      await screen.findByRole("button", { name: "Show chat" }),
    );
    await screen.findByTestId("chat-panel");

    await userEvent.click(screen.getByRole("button", { name: "Show theme" }));
    expect(await screen.findByTestId("theme-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).toBeNull();

    // A card followed while the sheet is up takes the slot back for chat.
    // The modal sheet hides the page from pointer and accessibility tree
    // alike, so the link is found by its text and clicked directly.
    act(() => {
      fireEvent.click(screen.getByText("Follow card"));
    });
    const panel = await screen.findByTestId("chat-panel");
    expect(panel).toHaveAttribute("data-channel", "ch-linked");
    expect(screen.queryByTestId("theme-panel")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no version history to preview", async () => {
    renderEditor({ route: "/p/:id", url: "/p/deck-1", element: <SlidesDetail /> });
    await screen.findByRole("button", { name: "Show chat" });
    expect(screen.queryByRole("button", { name: /version history/ })).toBeNull();
  });
});
