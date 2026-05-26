import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { fetchMe } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { UserPresence } from "@/components/user-presence";
import { ShareDialog } from "@/components/share-dialog";
import { usePresenceUpdater } from "@/hooks/use-presence-updater";
import { IconFolder, IconSettings, IconDatabase, IconMessage } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabBar } from "@/components/tab-bar";
import {
  SpreadsheetDocument,
  createWorksheet,
  TabType,
  TabMeta,
  initialSpreadsheetDocument,
} from "@/types/worksheet";
import type { UserPresence as UserPresenceType } from "@/types/users";
import type { DataSource } from "@/types/datasource";
import {
  buildTabNameNormalizationPatches,
  getNextDefaultSheetName,
  getUniqueTabName,
  isTabNameTaken,
  normalizeTabName,
} from "./tab-name";
import type { Thread, CommentAnchor } from "@wafflebase/sheets";
import { cellAnchorToSref } from "@wafflebase/sheets";
import { CommentSidePanel } from "@/components/comments/components/CommentSidePanel";
import type { SheetCellAnchor, Thread as SharedThread } from "@/types/comments";
import { copyThread } from "@/app/spreadsheet/yorkie-worksheet-comments";

const SheetView = lazy(() => import("@/app/spreadsheet/sheet-view"));
const DataSourceView = lazy(() =>
  import("@/app/spreadsheet/datasource-view").then((module) => ({
    default: module.DataSourceView,
  })),
);
const DataSourceSelector = lazy(() =>
  import("@/components/datasource-selector").then((module) => ({
    default: module.DataSourceSelector,
  })),
);

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

type PeerJumpTarget = {
  activeCell: NonNullable<UserPresenceType["activeCell"]>;
  targetTabId?: UserPresenceType["activeTabId"];
  requestId: number;
};

type CommentJumpTarget = {
  sref: string;
  requestId: number;
};

function DocumentLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();

  // Clean up stale pointer-events on body left by Radix Sheet from a
  // previous route (e.g. Layout's mobile sidebar unmounting mid-animation).
  useEffect(() => {
    document.body.style.removeProperty("pointer-events");
    return () => {
      document.body.style.removeProperty("pointer-events");
    };
  }, []);

  const queryClient = useQueryClient();
  const { doc, root: docRoot } = useDocument<SpreadsheetDocument, UserPresenceType>();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showDsSelector, setShowDsSelector] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    tabId: string;
    dependentNames: string[];
  } | null>(null);
  const [peerJumpTarget, setPeerJumpTarget] = useState<PeerJumpTarget | null>(
    null,
  );
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentJumpTarget, setCommentJumpTarget] = useState<CommentJumpTarget | null>(null);
  const commentJumpSeq = useRef(0);
  const jumpRequestSeq = useRef(0);

  const navigate = useNavigate();

  const {
    data: documentData,
    isError: isDocumentError,
  } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  useEffect(() => {
    document.title = documentData?.title
      ? `${documentData.title} — Wafflebase`
      : "Wafflebase";
  }, [documentData?.title]);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.id === documentData?.workspaceId,
  );
  const workspaceSlug = currentWorkspace?.slug;

  const fallbackSlug = workspaceSlug ?? workspaces[0]?.slug;

  useEffect(() => {
    if (isDocumentError) {
      toast.error("Document not found");
      navigate(fallbackSlug ? `/w/${fallbackSlug}` : "/documents", {
        replace: true,
      });
    }
  }, [isDocumentError, navigate, fallbackSlug]);

  const items = useMemo(() => {
    if (workspaceSlug) {
      return {
        main: [
          {
            title: "Documents",
            url: `/w/${workspaceSlug}`,
            icon: IconFolder,
          },
          {
            title: "Data Sources",
            url: `/w/${workspaceSlug}/datasources`,
            icon: IconDatabase,
          },
          {
            title: "Settings",
            url: `/w/${workspaceSlug}/settings`,
            icon: IconSettings,
          },
        ],
        secondary: [],
      };
    }

    return {
      main: [
        { title: "Documents", url: "/documents", icon: IconFolder },
        { title: "Data Sources", url: "/datasources", icon: IconDatabase },
        { title: "Settings", url: "/settings", icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug]);

  const handleWorkspaceChange = useCallback(
    (slug: string) => {
      navigate(`/w/${slug}`);
    },
    [navigate],
  );

  const handleRenameDocument = useCallback(
    async (newTitle: string) => {
      await renameDocument(documentId, newTitle);
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    [documentId, queryClient],
  );

  // Aggregate all comment threads across all sheet tabs for the side panel.
  // docRoot is the reactive root from useDocument — it updates on every local
  // or remote change, so the memo re-runs automatically without a manual
  // docVersion counter.
  const allThreads = useMemo<Thread[]>(() => {
    if (!docRoot?.sheets) return [];
    return Object.values(
      docRoot.sheets as Record<string, { comments?: Record<string, Thread> }>,
    ).flatMap((ws) =>
      Object.values(ws.comments ?? {}).map((t) => copyThread(t as Thread)),
    );
  }, [docRoot]);

  // Jump to the anchor cell: switch tab if needed, then signal SheetView to focus the cell.
  const handleJumpToCell = useCallback(
    (anchor: CommentAnchor) => {
      if (!doc) return;
      const root = doc.getRoot();
      const ws = root.sheets?.[anchor.tabId];
      if (!ws) return;

      const sref = cellAnchorToSref(
        { rowId: anchor.rowId, colId: anchor.colId },
        {
          rowOrder: Array.from(ws.rowOrder ?? []) as string[],
          colOrder: Array.from(ws.colOrder ?? []) as string[],
        },
      );
      if (!sref) return;

      // Switch to the target tab if it differs from the current one.
      if (anchor.tabId !== activeTabId) {
        setActiveTabId(anchor.tabId);
      }

      commentJumpSeq.current += 1;
      setCommentJumpTarget({ sref, requestId: commentJumpSeq.current });
    },
    [doc, activeTabId],
  );

  useEffect(() => {
    if (!doc) return;
    const root = doc.getRoot();
    if (root.tabOrder && root.tabOrder.length > 0 && !activeTabId) {
      setActiveTabId(root.tabOrder[0]);
    }
  }, [doc, activeTabId]);

  // Backfill old documents that may already contain duplicate tab names.
  useEffect(() => {
    if (!doc) return;

    let normalizing = false;

    const normalizeTabNames = () => {
      if (normalizing) return;
      const root = doc.getRoot();
      const patches = buildTabNameNormalizationPatches(root.tabOrder, root.tabs);
      if (patches.length === 0) return;

      normalizing = true;
      doc.update((r) => {
        for (const patch of patches) {
          if (r.tabs[patch.tabId]) {
            r.tabs[patch.tabId].name = patch.name;
          }
        }
      });
      normalizing = false;
    };

    normalizeTabNames();

    return doc.subscribe((event) => {
      if (event.type === "local-change" || event.type === "remote-change") {
        normalizeTabNames();
      }
    });
  }, [doc]);

  const addSheetTab = useCallback(() => {
    if (!doc) return;
    const root = doc.getRoot();
    const tabId = generateTabId();
    const tabName = getNextDefaultSheetName(root.tabs);

    doc.update((r) => {
      r.tabs[tabId] = {
        id: tabId,
        name: tabName,
        type: "sheet",
      } as TabMeta;
      r.tabOrder.push(tabId);
      r.sheets[tabId] = createWorksheet();
    });
    setActiveTabId(tabId);
  }, [doc]);

  const addPivotTab = useCallback(
    (sourceTabId: string, sourceRange: string) => {
      if (!doc) return;
      const tabId = generateTabId();
      const tabName = getUniqueTabName(
        doc.getRoot().tabs,
        "Pivot Table 1",
        "Pivot Table",
      );

      doc.update((r: SpreadsheetDocument) => {
        r.tabs[tabId] = {
          id: tabId,
          name: tabName,
          type: "sheet",
          kind: "pivot",
        };
        r.tabOrder.push(tabId);
        r.sheets[tabId] = createWorksheet({
          pivotTable: {
            id: crypto.randomUUID(),
            sourceTabId,
            sourceRange,
            rowFields: [],
            columnFields: [],
            valueFields: [],
            filterFields: [],
            showTotals: { rows: true, columns: true },
          },
        });
      });
      setActiveTabId(tabId);
    },
    [doc],
  );

  const addDataSourceTab = useCallback(
    (ds: DataSource) => {
      if (!doc) return;
      const root = doc.getRoot();
      const tabId = generateTabId();
      const tabName = getUniqueTabName(
        root.tabs,
        ds.name,
        "DataSource",
      );

      doc.update((r) => {
        r.tabs[tabId] = {
          id: tabId,
          name: tabName,
          type: "datasource",
          datasourceId: ds.id,
          query: "",
        } as TabMeta;
        r.tabOrder.push(tabId);
      });
      setActiveTabId(tabId);
    },
    [doc],
  );

  const handleAddTab = useCallback(
    (type: TabType) => {
      if (type === "datasource") {
        setShowDsSelector(true);
      } else {
        addSheetTab();
      }
    },
    [addSheetTab],
  );

  const handleRenameTab = useCallback(
    (tabId: string, name: string): boolean => {
      if (!doc) return false;
      const root = doc.getRoot();
      if (!root.tabs[tabId]) return false;

      const normalizedName = normalizeTabName(name);
      if (!normalizedName) return false;

      if (isTabNameTaken(root.tabs, normalizedName, tabId)) {
        toast.error(`Tab name "${normalizedName}" already exists.`);
        return false;
      }

      doc.update((r) => {
        if (r.tabs[tabId]) {
          r.tabs[tabId].name = normalizedName;
        }
      });
      return true;
    },
    [doc],
  );

  const deleteTabWithDependents = useCallback(
    (tabId: string, dependentPivotIds: string[]) => {
      if (!doc) return;
      const root = doc.getRoot();

      const allToDelete = [tabId, ...dependentPivotIds];
      const idx = root.tabOrder.indexOf(tabId);
      doc.update((r) => {
        for (const id of allToDelete) {
          delete r.tabs[id];
          if (r.sheets[id]) {
            delete r.sheets[id];
          }
          const orderIdx = r.tabOrder.indexOf(id);
          if (orderIdx !== -1) {
            r.tabOrder.splice(orderIdx, 1);
          }
        }
      });

      if (dependentPivotIds.length > 0) {
        toast.info(
          `Deleted ${dependentPivotIds.length} dependent pivot table(s).`,
        );
      }

      // Switch to an adjacent tab if active tab was deleted.
      if (allToDelete.includes(activeTabId)) {
        const newRoot = doc.getRoot();
        const newIdx = Math.min(idx, newRoot.tabOrder.length - 1);
        setActiveTabId(newRoot.tabOrder[newIdx]);
      }
    },
    [doc, activeTabId],
  );

  const handleDeleteTab = useCallback(
    (tabId: string) => {
      if (!doc) return;
      const root = doc.getRoot();
      if (root.tabOrder.length <= 1) return;

      // Collect pivot tabs that depend on the tab being deleted.
      const dependentPivotIds: string[] = [];
      for (const tid of root.tabOrder) {
        const id = String(tid);
        const pt = root.sheets?.[id]?.pivotTable;
        if (pt && String(pt.sourceTabId) === tabId) {
          dependentPivotIds.push(id);
        }
      }

      // If there are dependent pivots, confirm before deleting.
      if (dependentPivotIds.length > 0) {
        // Ensure at least one tab remains after cascade deletion.
        const allToDelete = new Set([tabId, ...dependentPivotIds]);
        const remaining = Array.from(root.tabOrder).filter(
          (t) => !allToDelete.has(String(t)),
        );
        if (remaining.length === 0) {
          toast.error(
            "Cannot delete: all remaining tabs depend on this sheet.",
          );
          return;
        }

        const dependentNames = dependentPivotIds.map(
          (id) => root.tabs[id]?.name ?? id,
        );
        setPendingDelete({ tabId, dependentNames });
        return;
      }

      deleteTabWithDependents(tabId, []);
    },
    [doc, deleteTabWithDependents],
  );

  const confirmPendingDelete = useCallback(() => {
    if (!pendingDelete || !doc) return;
    const root = doc.getRoot();

    // Re-collect dependents (state may have changed).
    const dependentPivotIds: string[] = [];
    for (const tid of root.tabOrder) {
      const id = String(tid);
      const pt = root.sheets?.[id]?.pivotTable;
      if (pt && String(pt.sourceTabId) === pendingDelete.tabId) {
        dependentPivotIds.push(id);
      }
    }

    deleteTabWithDependents(pendingDelete.tabId, dependentPivotIds);
    setPendingDelete(null);
  }, [pendingDelete, doc, deleteTabWithDependents]);

  const handleMoveTab = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!doc) return;
      doc.update((r) => {
        const [moved] = r.tabOrder.splice(fromIndex, 1);
        r.tabOrder.splice(toIndex, 0, moved);
      });
    },
    [doc],
  );

  const handleSelectPeer = useCallback(
    (clientID: string) => {
      if (!doc) return;
      const peer = doc
        .getOthersPresences()
        .find((p) => p.clientID === clientID);
      const activeCell = peer?.presence?.activeCell as
        | NonNullable<UserPresenceType["activeCell"]>
        | undefined;
      const peerActiveTabId = peer?.presence?.activeTabId as
        | UserPresenceType["activeTabId"]
        | undefined;
      if (!activeCell) return;

      const root = doc.getRoot();
      const activeTab = peerActiveTabId ? root.tabs[peerActiveTabId] : undefined;
      let targetTabId: string | undefined;
      if (activeTab?.type === "sheet") {
        targetTabId = peerActiveTabId;
      } else {
        const currentTab = activeTabId ? root.tabs[activeTabId] : undefined;
        if (currentTab?.type === "sheet") {
          targetTabId = activeTabId;
        } else {
          targetTabId = root.tabOrder.find(
            (id: string) => root.tabs[id]?.type === "sheet",
          );
        }
      }
      if (!targetTabId) return;

      if (targetTabId !== activeTabId) {
        setActiveTabId(targetTabId);
      }
      jumpRequestSeq.current += 1;
      setPeerJumpTarget({
        activeCell,
        targetTabId,
        requestId: jumpRequestSeq.current,
      });
    },
    [doc, activeTabId],
  );

  const getJumpHint = useCallback(
    (clientID: string) => {
      const peer = doc
        ?.getOthersPresences()
        .find((p) => p.clientID === clientID);
      const activeCell = peer?.presence?.activeCell as string | undefined;
      return activeCell;
    },
    [doc],
  );

  if (!doc || !activeTabId) {
    return <Loader />;
  }

  const root = doc.getRoot();
  const tabs: TabMeta[] = root.tabOrder
    .map((id: string) => root.tabs[id])
    .filter(Boolean);
  const activeTab = root.tabs[activeTabId];

  return (
    <SidebarProvider>
      <AppSidebar
        variant="inset"
        items={items}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onWorkspaceChange={handleWorkspaceChange}
      />
      <SidebarInset>
        <SiteHeader
          title={documentData?.title ?? "Loading..."}
          editable
          onRename={handleRenameDocument}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted ${
                commentsPanelOpen ? "bg-muted" : ""
              }`}
              aria-label={commentsPanelOpen ? "Hide comments" : "Show comments"}
              aria-pressed={commentsPanelOpen}
              onClick={() => setCommentsPanelOpen((v) => !v)}
            >
              <IconMessage size={16} />
            </button>
            <ShareDialog documentId={documentId} />
            <UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
          </div>
        </SiteHeader>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col min-w-0">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col h-full">
                <Suspense fallback={<Loader />}>
                  {activeTab?.type === "datasource" ? (
                    <DataSourceView tabId={activeTabId} />
                  ) : (
                    <SheetView
                      tabId={activeTabId}
                      peerJumpTarget={peerJumpTarget}
                      commentJumpTarget={commentJumpTarget}
                      addPivotTab={addPivotTab}
                      workspaceId={documentData?.workspaceId}
                      onToggleCommentsPanel={() => setCommentsPanelOpen((v) => !v)}
                    />
                  )}
                </Suspense>
              </div>
            </div>
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onAddTab={handleAddTab}
              onRenameTab={handleRenameTab}
              onDeleteTab={handleDeleteTab}
              onMoveTab={handleMoveTab}
            />
          </div>
          {commentsPanelOpen && (
            <CommentSidePanel<SheetCellAnchor>
              threads={allThreads as unknown as SharedThread<SheetCellAnchor>[]}
              onJumpTo={(t) => handleJumpToCell(t.anchor)}
              onClose={() => setCommentsPanelOpen(false)}
              renderAnchorLabel={(t) => {
                const ws = doc?.getRoot().sheets?.[t.anchor.tabId];
                if (!ws) return null;
                const sref = cellAnchorToSref(
                  { rowId: t.anchor.rowId, colId: t.anchor.colId },
                  {
                    rowOrder: Array.from(ws.rowOrder ?? []) as string[],
                    colOrder: Array.from(ws.colOrder ?? []) as string[],
                  },
                );
                return sref ? <span>{sref}</span> : null;
              }}
            />
          )}
        </div>
      </SidebarInset>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tab</DialogTitle>
            <DialogDescription>
              This tab is referenced by{" "}
              {pendingDelete?.dependentNames.length === 1
                ? "a pivot table"
                : `${pendingDelete?.dependentNames.length} pivot tables`}
              . Deleting it will also remove:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {pendingDelete?.dependentNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmPendingDelete}>
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showDsSelector && documentData?.workspaceId && (
        <Suspense fallback={null}>
          <DataSourceSelector
            workspaceId={documentData.workspaceId}
            open={showDsSelector}
            onOpenChange={setShowDsSelector}
            onSelect={addDataSourceTab}
          />
        </Suspense>
      )}
    </SidebarProvider>
  );
}

/**
 * Renders the DocumentDetail component.
 */
export function DocumentDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (isLoading) {
    return <Loader />;
  }

  if (isError || !currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Ensure all user data is available
  if (!currentUser.username || !currentUser.email) {
    return <Loader />;
  }

  // NOTE(hackerwins): Fetch the document from the server using the id.
  // NOTE(hackerwins): instead of using the document id, consider using hash-based key.
  return (
    <DocumentProvider
      docKey={`sheet-${id}`}
      initialRoot={initialSpreadsheetDocument()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <DocumentLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default DocumentDetail;
