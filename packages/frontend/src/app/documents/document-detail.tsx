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
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
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

function DocumentLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const queryClient = useQueryClient();
  const { doc } = useDocument<SpreadsheetDocument, UserPresenceType>();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showDsSelector, setShowDsSelector] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    tabId: string;
    dependentNames: string[];
  } | null>(null);
  const [peerJumpTarget, setPeerJumpTarget] = useState<PeerJumpTarget | null>(
    null,
  );
  const jumpRequestSeq = useRef(0);

  const navigate = useNavigate();

  const { data: documentData } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
  });

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.id === documentData?.workspaceId,
  );
  const workspaceSlug = currentWorkspace?.slug;

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

  const handleSelectPresenceCell = useCallback(
    (
      activeCell: NonNullable<UserPresenceType["activeCell"]>,
      peerActiveTabId?: UserPresenceType["activeTabId"],
    ) => {
      if (!doc || !activeCell) return;

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
            <ShareDialog documentId={documentId} />
            <UserPresence onSelectActiveCell={handleSelectPresenceCell} />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col h-full">
              <Suspense fallback={<Loader />}>
                {activeTab?.type === "datasource" ? (
                  <DataSourceView tabId={activeTabId} />
                ) : (
                  <SheetView tabId={activeTabId} peerJumpTarget={peerJumpTarget} addPivotTab={addPivotTab} />
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
