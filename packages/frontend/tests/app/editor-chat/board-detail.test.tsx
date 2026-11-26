import { vi } from "vitest";

const doc = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@yorkie-js/react", async () =>
  (await import("./harness")).yorkieMock(() => doc.current),
);
vi.mock("@/api/auth", async () => (await import("./harness")).authMock);
vi.mock("@/api/workspaces", async () => (await import("./harness")).workspacesMock);
vi.mock("@/api/documents", async () =>
  (await import("./harness")).documentsMock("board"),
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
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/user-presence", () => ({ UserPresence: () => null }));
vi.mock("@/app/board/board-view", () => ({ BoardView: () => null }));
// The board's comments are drawn by its collab provider from the
// `panel={[open, setOpen]}` pair the page hands it.
vi.mock("@/app/board/rituals/board-collab-context", async () => ({
  BoardCollabProvider: (await import("./harness")).PanelPairProvider,
}));
vi.mock("@/app/board/rituals/board-comments-panel", async () => {
  const h = await import("./harness");
  return {
    BoardCommentsToggle: h.PanelPairToggle,
    BoardCommentsPanel: h.PanelPairPanel,
  };
});

import { BoardDetail } from "@/app/board/board-detail";
import { describeEditorChatPanel, fakeDoc } from "./harness";

doc.current = fakeDoc();

describeEditorChatPanel("board", {
  route: "/b/:id",
  documentId: "board-1",
  element: () => <BoardDetail />,
  other: { label: "comments", testId: "comments-panel" },
  preview: true,
});
