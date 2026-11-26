import { vi } from "vitest";

const doc = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@yorkie-js/react", async () =>
  (await import("./harness")).yorkieMock(() => doc.current),
);
vi.mock("@/api/auth", async () => (await import("./harness")).authMock);
vi.mock("@/api/workspaces", async () => (await import("./harness")).workspacesMock);
vi.mock("@/api/documents", async () =>
  (await import("./harness")).documentsMock("doc"),
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
vi.mock("@/app/docs/docs-export-button", () => ({ DocsExportButton: () => null }));
vi.mock("@/app/docs/docs-formatting-toolbar", () => ({
  DocsFormattingToolbar: () => null,
}));
// The engine view. Docs draws its comments panel inside the view, from the
// flag the page hands it.
vi.mock("@/app/docs/docs-view", () => ({
  DocsView: ({ commentsPanelOpen }: { commentsPanelOpen: boolean }) =>
    commentsPanelOpen ? <div data-testid="comments-panel" /> : null,
}));

import { DocsDetail } from "@/app/docs/docs-detail";
import { describeEditorChatPanel, fakeDoc } from "./harness";

doc.current = fakeDoc();

describeEditorChatPanel("docs", {
  route: "/d/:id",
  documentId: "doc-1",
  element: () => <DocsDetail />,
  other: { label: "comments", testId: "comments-panel" },
  preview: true,
});
