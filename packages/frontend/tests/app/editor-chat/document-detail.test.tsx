import { vi } from "vitest";

const doc = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@yorkie-js/react", async () =>
  (await import("./harness")).yorkieMock(() => doc.current),
);
vi.mock("@/api/auth", async () => (await import("./harness")).authMock);
vi.mock("@/api/workspaces", async () => (await import("./harness")).workspacesMock);
vi.mock("@/api/documents", async () =>
  (await import("./harness")).documentsMock("sheet"),
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
vi.mock("@/api/lakehouse", () => ({
  fetchWorkspaceLakehouseSources: vi.fn(async () => []),
}));
vi.mock("@/components/comments/components/CommentSidePanel", () => ({
  CommentSidePanel: () => <div data-testid="comments-panel" />,
}));
// The engine view: reports the tab it mounted and the selection the page
// handed it through the jump channel a `?at=` anchor shares with undo.
vi.mock("@/app/spreadsheet/sheet-view", () => ({
  default: ({
    tabId,
    undoJumpTarget,
  }: {
    tabId: string;
    undoJumpTarget: { selection: unknown } | null;
  }) => (
    <div
      data-testid="sheet-view"
      data-tab={tabId}
      data-jump={undoJumpTarget ? JSON.stringify(undoJumpTarget.selection) : ""}
    />
  ),
}));

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { DocumentDetail } from "@/app/documents/document-detail";
import { encodeAnchor } from "@/components/chat/document-link";
import { createWorksheet, initialSpreadsheetDocument } from "@/types/worksheet";
import { describeEditorChatPanel, fakeDoc, renderEditor } from "./harness";

function workbook() {
  const root = structuredClone(initialSpreadsheetDocument());
  root.sheets["tab-1"].rowOrder = ["r1", "r2", "r3"];
  root.sheets["tab-1"].colOrder = ["c1", "c2", "c3"];
  root.tabs["tab-2"] = { id: "tab-2", name: "Q4", type: "sheet" };
  root.tabOrder.push("tab-2");
  root.sheets["tab-2"] = {
    ...createWorksheet(),
    rowOrder: ["q1", "q2"],
    colOrder: ["k1", "k2"],
  };
  return root;
}

beforeEach(() => {
  doc.current = fakeDoc(workbook());
});

describeEditorChatPanel("sheet", {
  route: "/s/:id",
  documentId: "sheet-1",
  element: () => <DocumentDetail />,
  other: { label: "comments", testId: "comments-panel" },
  preview: true,
});

const at = (anchor: Parameters<typeof encodeAnchor>[0]) =>
  `?at=${encodeAnchor(anchor)}`;

function mountAt(search: string, follow?: string) {
  return renderEditor({
    route: "/s/:id",
    url: `/s/sheet-1${search}`,
    element: <DocumentDetail />,
    follow,
  });
}

async function sheetView() {
  return screen.findByTestId("sheet-view");
}

/** The selection the sheet engine was asked to show, once it was asked. */
async function jumpedTo() {
  let jump = "";
  await waitFor(async () => {
    jump = (await sheetView()).getAttribute("data-jump") ?? "";
    expect(jump).not.toBe("");
  });
  return JSON.parse(jump);
}

describe("sheet ?at= anchor", () => {
  it("selects the anchored range, found by its axis ids", async () => {
    mountAt(at({ tabId: "tab-1", rowId: "r2", colId: "c2", rowSpan: 2, colSpan: 1 }));
    expect(await jumpedTo()).toEqual({
      tabId: "tab-1",
      otherTab: false,
      selectionType: "cell",
      range: [
        { r: 2, c: 2 },
        { r: 3, c: 2 },
      ],
    });
    expect(await sheetView()).toHaveAttribute("data-tab", "tab-1");
  });

  it("switches to the anchored tab first", async () => {
    mountAt(at({ tabId: "tab-2", rowId: "q2", colId: "k1", rowSpan: 1, colSpan: 2 }));
    const jump = await jumpedTo();
    expect(jump.tabId).toBe("tab-2");
    expect(jump.range).toEqual([
      { r: 2, c: 1 },
      { r: 2, c: 2 },
    ]);
    expect(await sheetView()).toHaveAttribute("data-tab", "tab-2");
  });

  // A row deleted since the link was sent: the document is still the right
  // place, so the editor opens where it would have anyway.
  it("leaves the editor where it opened for a deleted row", async () => {
    mountAt(at({ tabId: "tab-2", rowId: "gone", colId: "k1", rowSpan: 1, colSpan: 1 }));
    const view = await sheetView();
    await act(async () => {});
    expect(view).toHaveAttribute("data-tab", "tab-1");
    expect(view).toHaveAttribute("data-jump", "");
  });

  // The jump channel drops what arrives during a preview, which is right for
  // an undo step but not for a card: the anchor still names a place in the
  // live document, so it waits for the preview to close.
  it("applies an anchor followed during a revision preview once it closes", async () => {
    mountAt(
      "",
      at({ tabId: "tab-1", rowId: "r3", colId: "c1", rowSpan: 1, colSpan: 1 }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Show version history" }),
    );
    await userEvent.click(await screen.findByText("Preview revision"));
    await screen.findByTestId("revision-preview");

    await userEvent.click(screen.getByText("Follow card"));
    await act(async () => {});
    expect(await sheetView()).toHaveAttribute("data-jump", "");

    await userEvent.click(screen.getByText("Close preview"));
    expect((await jumpedTo()).range).toEqual([
      { r: 3, c: 1 },
      { r: 3, c: 1 },
    ]);
  });
});
