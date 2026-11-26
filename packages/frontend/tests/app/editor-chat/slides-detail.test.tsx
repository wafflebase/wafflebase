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
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/user-presence", () => ({ UserPresence: () => null }));
vi.mock("@/hooks/use-auto-collapse-sidebar", () => ({
  useAutoCollapseSidebar: () => ({ open: true, onOpenChange: () => undefined }),
}));
vi.mock("@/app/slides/slides-view", () => ({ SlidesView: () => null }));
vi.mock("@/app/slides/mobile-slides-view", () => ({ MobileSlidesView: () => null }));
vi.mock("@/app/slides/toolbar", () => ({ SlidesToolbar: () => null }));
vi.mock("@/app/slides/slides-presentation-mode", () => ({
  SlidesPresentationMode: () => null,
}));
vi.mock("@/app/slides/slides-present-button", () => ({ PresentButton: () => null }));
vi.mock("@/app/slides/slides-export-button", () => ({
  SlidesExportButton: () => null,
}));
vi.mock("@/app/slides/theme-panel", () => ({ ThemePanel: () => null }));
vi.mock("@/app/slides/format-panel", () => ({ FormatPanel: () => null }));
vi.mock("@/app/slides/motion-panel", () => ({ MotionPanel: () => null }));
vi.mock("@/app/slides/background-side-panel", () => ({
  BackgroundSidePanel: () => null,
}));

import { SlidesDetail } from "@/app/slides/slides-detail";
import { describeEditorChatPanel, fakeDoc } from "./harness";

doc.current = fakeDoc();

// Slides has no comments; its right-hand panels are one union, history
// among them.
describeEditorChatPanel("slides", {
  route: "/p/:id",
  documentId: "deck-1",
  element: () => <SlidesDetail />,
  other: { label: "version history", testId: "history-panel" },
  preview: true,
});
