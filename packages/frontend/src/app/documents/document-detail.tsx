import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";
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
import SheetView from "@/app/spreadsheet/sheet-view";
import { TabBar } from "@/components/tab-bar";
import { DataSourceView } from "@/app/spreadsheet/datasource-view";
import { DataSourceSelector } from "@/components/datasource-selector";
import {
  SpreadsheetDocument,
  Worksheet,
  TabType,
  TabMeta,
  initialSpreadsheetDocument,
} from "@/types/worksheet";
import type { UserPresence as UserPresenceType } from "@/types/users";
import type { DataSource } from "@/types/datasource";

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

  const root = doc.getRoot();

  // If `tabs` already exists, no migration needed.
  if (root.tabs) return;

  // Old format detected: root has `sheet` but no `tabs`.
  const oldRoot = root as unknown as Record<string, unknown>;
  if (!oldRoot.sheet) return;

  const tabId = "tab-1";
  doc.update((r: Record<string, unknown>) => {
    // Build the new structure, preserving existing data
    r.tabs = {
      [tabId]: {
        id: tabId,
        name: "Sheet1",
        type: "sheet" as const,
      },
    };
    r.tabOrder = [tabId];
    r.sheets = {
      [tabId]: {
        sheet: r.sheet || {},
        rowHeights: r.rowHeights || {},
        colWidths: r.colWidths || {},
        colStyles: r.colStyles || {},
        rowStyles: r.rowStyles || {},
        sheetStyle: r.sheetStyle,
        merges: (r as Record<string, unknown>).merges || {},
        frozenRows: r.frozenRows || 0,
        frozenCols: r.frozenCols || 0,
      },
    };

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

function DocumentLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const queryClient = useQueryClient();
  const { doc } = useDocument<SpreadsheetDocument, UserPresenceType>();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [migrated, setMigrated] = useState(false);
  const [showDsSelector, setShowDsSelector] = useState(false);

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

  const addSheetTab = useCallback(() => {
    if (!doc) return;
    const root = doc.getRoot();
    const tabId = generateTabId();
    const count =
      root.tabOrder.filter((id: string) => root.tabs[id]?.type === "sheet")
        .length + 1;

    doc.update((r) => {
      r.tabs[tabId] = {
        id: tabId,
        name: `Sheet${count}`,
        type: "sheet",
      } as TabMeta;
      r.tabOrder.push(tabId);
      r.sheets[tabId] = {
        sheet: {},
        rowHeights: {},
        colWidths: {},
        colStyles: {},
        rowStyles: {},
        merges: {},
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
      const count =
        root.tabOrder.filter(
          (id: string) => root.tabs[id]?.type === "datasource",
        ).length + 1;

      doc.update((r) => {
        r.tabs[tabId] = {
          id: tabId,
          name: ds.name || `DataSource${count}`,
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
    (tabId: string, name: string) => {
      if (!doc) return;
      doc.update((r) => {
        if (r.tabs[tabId]) {
          r.tabs[tabId].name = name;
        }
      });
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
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col h-full">
              {activeTab?.type === "datasource" ? (
                <DataSourceView tabId={activeTabId} />
              ) : (
                <SheetView tabId={activeTabId} />
              )}
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

      <DataSourceSelector
        open={showDsSelector}
        onOpenChange={setShowDsSelector}
        onSelect={addDataSourceTab}
      />
    </SidebarProvider>
  );
}

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
    return <div>User not found</div>;
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
