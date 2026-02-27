import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { YorkieProvider, DocumentProvider, useDocument } from "@yorkie-js/react";
import { resolveShareLink, ResolvedShareLink } from "@/api/share-links";
import { fetchMeOptional } from "@/api/auth";
import { Loader } from "@/components/loader";
import SheetView from "@/app/spreadsheet/sheet-view";
import {
  SpreadsheetDocument,
  TabMeta,
  initialSpreadsheetDocument,
} from "@/types/worksheet";
import type { UserPresence as UserPresenceType } from "@/types/users";
import { IconDatabase, IconTable } from "@tabler/icons-react";

const DataSourceView = lazy(() =>
  import("@/app/spreadsheet/datasource-view").then((module) => ({
    default: module.DataSourceView,
  })),
);

function SharedDocumentLayout({
  resolved,
}: {
  resolved: ResolvedShareLink;
}) {
  const readOnly = resolved.role === "viewer";
  const { doc } = useDocument<SpreadsheetDocument, UserPresenceType>();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const root = doc?.getRoot();
  const tabs: TabMeta[] = useMemo(
    () =>
      root
        ? (root.tabOrder || [])
            .map((id: string) => root.tabs[id])
            .filter(Boolean)
        : [],
    [root]
  );

  useEffect(() => {
    if (!root) return;
    if (!tabs.length) {
      setActiveTabId(null);
      return;
    }
    if (!activeTabId || !root.tabs[activeTabId]) {
      setActiveTabId(tabs[0].id);
    }
  }, [activeTabId, root, tabs]);

  if (!doc || !root) {
    return <Loader />;
  }

  if (!activeTabId) {
    return <Loader />;
  }

  const activeTab = root.tabs[activeTabId];

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-base font-medium">{resolved.title}</h1>
        {readOnly && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            View only
          </span>
        )}
      </header>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col">
          <Suspense fallback={<Loader />}>
            {activeTab?.type === "datasource" ? (
              <DataSourceView tabId={activeTabId} readOnly={readOnly} />
            ) : (
              <SheetView tabId={activeTabId} readOnly={readOnly} />
            )}
          </Suspense>
        </div>
        <div className="flex items-center border-t bg-muted/30 px-1 h-9 shrink-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`flex shrink-0 items-center gap-1.5 px-3 py-1 text-sm rounded-t border-b-2 cursor-pointer select-none hover:bg-muted/50 transition-colors ${
                tab.id === activeTabId
                  ? "border-primary bg-background text-foreground font-medium"
                  : "border-transparent text-muted-foreground"
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.type === "datasource" ? (
                <IconDatabase className="size-3.5" />
              ) : (
                <IconTable className="size-3.5" />
              )}
              <span>{tab.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SharedDocumentInner({
  resolved,
}: {
  resolved: ResolvedShareLink;
}) {
  const { data: currentUser } = useQuery({
    queryKey: ["me", "optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  const presence = {
    username: currentUser?.username || "Anonymous",
    email: currentUser?.email || "",
    photo: currentUser?.photo || "",
  };

  return (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_API_KEY}
      metadata={{ userID: presence.username }}
    >
      <DocumentProvider
        docKey={`sheet-${resolved.documentId}`}
        initialRoot={initialSpreadsheetDocument}
        initialPresence={presence}
        enableDevtools={import.meta.env.DEV}
      >
        <SharedDocumentLayout resolved={resolved} />
      </DocumentProvider>
    </YorkieProvider>
  );
}

/**
 * Renders the SharedDocument component.
 */
export function SharedDocument() {
  const { token } = useParams<{ token: string }>();
  const [resolved, setResolved] = useState<ResolvedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("No share token provided");
      setLoading(false);
      return;
    }

    resolveShareLink(token)
      .then((data) => {
        setResolved(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Invalid or expired link");
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return <Loader />;
  }

  if (error || !resolved) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Link unavailable</h1>
          <p className="text-muted-foreground">{error || "Invalid or expired link"}</p>
        </div>
      </div>
    );
  }

  return <SharedDocumentInner resolved={resolved} />;
}

export default SharedDocument;
