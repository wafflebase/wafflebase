import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useCallback,
  useEffect,
  useRef,
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
import { toast } from "sonner";
import { TabBar } from "@/components/tab-bar";
import {
  SpreadsheetDocument,
  Worksheet,
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
import {
  buildLegacySpreadsheetDocument,
  shouldMigrateLegacyDocument,
} from "./migration";

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

const items = {
  main: [
    {
      title: "Documents",
      url: "/",
      icon: IconFolder,
    },
    {
      title: "Data Sources",
      url: "/datasources",
      icon: IconDatabase,
    },
  ],
  secondary: [
    {
      title: "Settings",
      url: "/settings",
      icon: IconSettings,
    },
  ],
};

/**
 * Detects old flat Worksheet format and migrates to SpreadsheetDocument.
 */
function migrateDocument(
  doc: ReturnType<
    typeof useDocument<SpreadsheetDocument, UserPresenceType>
  >["doc"],
) {
  if (!doc) return;

  const root = doc.getRoot() as unknown as Record<string, unknown>;
  if (!shouldMigrateLegacyDocument(root)) return;

  doc.update((r: Record<string, unknown>) => {
    const migrated = buildLegacySpreadsheetDocument(r);
    if (!migrated) return;

    r.tabs = migrated.tabs;
    r.tabOrder = migrated.tabOrder;
    r.sheets = migrated.sheets;

    // Remove old flat keys
    delete r.sheet;
    delete r.rowHeights;
    delete r.colWidths;
    delete r.colStyles;
    delete r.rowStyles;
    delete r.sheetStyle;
    delete r.merges;
    delete r.frozenRows;
    delete r.frozenCols;
  });
}

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
  const [migrated, setMigrated] = useState(false);
  const [showDsSelector, setShowDsSelector] = useState(false);
  const [peerJumpTarget, setPeerJumpTarget] = useState<PeerJumpTarget | null>(
    null,
  );
  const jumpRequestSeq = useRef(0);

  const { data: documentData } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
  });

  const handleRenameDocument = useCallback(
    async (newTitle: string) => {
      await renameDocument(documentId, newTitle);
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    [documentId, queryClient],
  );

  // Perform migration on first load
  useEffect(() => {
    if (!doc) return;
    migrateDocument(doc);
    setMigrated(true);
  }, [doc]);

  // Set initial active tab after migration
  useEffect(() => {
    if (!doc || !migrated) return;
    const root = doc.getRoot();
    if (root.tabOrder && root.tabOrder.length > 0 && !activeTabId) {
      setActiveTabId(root.tabOrder[0]);
    }
  }, [doc, migrated, activeTabId]);

  // Backfill old documents that may already contain duplicate tab names.
  useEffect(() => {
    if (!doc || !migrated) return;

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
  }, [doc, migrated]);

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
      r.sheets[tabId] = {
        sheet: {},
        rowHeights: {},
        colWidths: {},
        colStyles: {},
        rowStyles: {},
        conditionalFormats: [],
        merges: {},
        charts: {},
        frozenRows: 0,
        frozenCols: 0,
      } as Worksheet;
    });
    setActiveTabId(tabId);
  }, [doc]);

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

  const handleDeleteTab = useCallback(
    (tabId: string) => {
      if (!doc) return;
      const root = doc.getRoot();
      if (root.tabOrder.length <= 1) return;

      const idx = root.tabOrder.indexOf(tabId);
      doc.update((r) => {
        delete r.tabs[tabId];
        if (r.sheets[tabId]) {
          delete r.sheets[tabId];
        }
        const orderIdx = r.tabOrder.indexOf(tabId);
        if (orderIdx !== -1) {
          r.tabOrder.splice(orderIdx, 1);
        }
      });

      // Switch to an adjacent tab
      if (activeTabId === tabId) {
        const newRoot = doc.getRoot();
        const newIdx = Math.min(idx, newRoot.tabOrder.length - 1);
        setActiveTabId(newRoot.tabOrder[newIdx]);
      }
    },
    [doc, activeTabId],
  );

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

  if (!doc || !migrated || !activeTabId) {
    return <Loader />;
  }

  const root = doc.getRoot();
  const tabs: TabMeta[] = root.tabOrder
    .map((id: string) => root.tabs[id])
    .filter(Boolean);
  const activeTab = root.tabs[activeTabId];

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" items={items} />
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
                  <SheetView tabId={activeTabId} peerJumpTarget={peerJumpTarget} />
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

      {showDsSelector && (
        <Suspense fallback={null}>
          <DataSourceSelector
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
      initialRoot={initialSpreadsheetDocument}
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
