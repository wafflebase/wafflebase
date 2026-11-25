import { vi } from "vitest";

const type = vi.hoisted(() => ({ current: "pdf" }));

vi.mock("@/api/auth", async () => (await import("./harness")).authMock);
vi.mock("@/api/workspaces", async () => (await import("./harness")).workspacesMock);
vi.mock("@/api/documents", async () => {
  const h = await import("./harness");
  const api = h.documentsMock("pdf");
  const fetchDocument = api.fetchDocument;
  // The document type is the case under test, so it is read per call.
  return {
    ...api,
    fetchDocument: vi.fn(async (id: string) => ({
      ...(await fetchDocument(id)),
      type: type.current,
      fileId: `${id}.bin`,
    })),
  };
});
vi.mock("@/api/download-file", () => ({ downloadDocumentFile: vi.fn() }));
vi.mock("@/components/site-header", async () =>
  (await import("./harness")).siteHeaderMock,
);
vi.mock("@/components/chat/chat-panel-slot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/chat/chat-panel-slot")>()),
  LazyChatPanel: (await import("./harness")).ChatPanelMarker,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/user-presence", () => ({ UserPresence: () => null }));
// The PDF viewer's comments are drawn by its collab provider from the
// `panel={[open, setOpen]}` pair the page hands it.
vi.mock("@/app/files/pdf-collab", async () => {
  const h = await import("./harness");
  return {
    PdfCollabProvider: h.PanelPairProvider,
    PdfHeaderActions: h.PanelPairToggle,
    PdfCollabBody: h.PanelPairPanel,
  };
});
vi.mock("@/app/files/image-viewer", () => ({ ImageViewer: () => null }));
vi.mock("@/app/files/generic-file-view", () => ({ GenericFileView: () => null }));

import { beforeEach, describe } from "vitest";

import { FileDetail } from "@/app/files/file-detail";
import { describeEditorChatPanel } from "./harness";

describe.each([
  { kind: "pdf", other: { label: "comments", testId: "comments-panel" } },
  { kind: "image", other: undefined },
  { kind: "file", other: undefined },
])("$kind viewer", ({ kind, other }) => {
  beforeEach(() => {
    type.current = kind;
  });

  // No version history for a blob, so no revision preview to withhold for.
  describeEditorChatPanel(kind, {
    route: "/f/:id",
    documentId: "file-1",
    element: () => <FileDetail />,
    other,
    preview: false,
  });
});
