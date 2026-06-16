import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { YorkieProvider, DocumentProvider, useDocument } from "@yorkie-js/react";
import { toast } from "sonner";
import { resolveShareLink, ResolvedShareLink } from "@/api/share-links";
import { fetchMeOptional } from "@/api/auth";
import { Loader } from "@/components/loader";
import SheetView from "@/app/spreadsheet/sheet-view";
import {
  SpreadsheetDocument,
  TabMeta,
  initialSpreadsheetDocument,
} from "@/types/worksheet";
import { initialDocsRoot, type YorkieDocsRoot } from "@/types/docs-document";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { UserPresence as UserPresenceType } from "@/types/users";
import { UserPresence } from "@/components/user-presence";
import { useIsMobile } from "@/hooks/use-mobile";
import { DocsView, type EditorAPI } from "@/app/docs/docs-view";
import { DocsFormattingToolbar } from "@/app/docs/docs-formatting-toolbar";
import type { SlidesEditor, Theme } from "@wafflebase/slides";
import type { YorkieSlidesStore } from "@/app/slides/yorkie-slides-store";
import { IconDatabase, IconMessage, IconTable } from "@tabler/icons-react";

type PeerJumpTarget = {
  activeCell: NonNullable<UserPresenceType["activeCell"]>;
  targetTabId?: UserPresenceType["activeTabId"];
  requestId: number;
};

const DataSourceView = lazy(() =>
  import("@/app/spreadsheet/datasource-view").then((module) => ({
    default: module.DataSourceView,
  })),
);

// Slides editor + @wafflebase/slides bundle is heavy (see
// `slides-detail-*` chunk override in harness.config.json). Lazy-load
// it so non-slides share links don't pay the cost.
const SlidesView = lazy(() =>
  import("@/app/slides/slides-view").then((module) => ({
    default: module.SlidesView,
  })),
);

const SlidesToolbar = lazy(() =>
  import("@/app/slides/toolbar").then((module) => ({
    default: module.SlidesToolbar,
  })),
);

const MobileSlidesView = lazy(() =>
  import("@/app/slides/mobile-slides-view").then((module) => ({
    default: module.MobileSlidesView,
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
  const [peerJumpTarget, setPeerJumpTarget] = useState<PeerJumpTarget | null>(null);
  const jumpRequestSeq = useRef(0);
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

      if (peerActiveTabId && peerActiveTabId !== activeTabId) {
        setActiveTabId(peerActiveTabId);
      }

      jumpRequestSeq.current += 1;
      setPeerJumpTarget({
        activeCell,
        targetTabId: peerActiveTabId,
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
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          {readOnly && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              View only
            </span>
          )}
        </div>
        <UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
      </header>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col">
          <Suspense fallback={<Loader />}>
            {activeTab?.type === "datasource" ? (
              <DataSourceView tabId={activeTabId} readOnly={readOnly} />
            ) : (
              <SheetView tabId={activeTabId} readOnly={readOnly} peerJumpTarget={peerJumpTarget} />
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

function SharedDocsLayout({ resolved }: { resolved: ResolvedShareLink }) {
  const readOnly = resolved.role === "viewer";
  const [editor, setEditor] = useState<EditorAPI | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          {readOnly && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              View only
            </span>
          )}
        </div>
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
          <UserPresence />
        </div>
      </header>
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {!readOnly && <DocsFormattingToolbar editor={editor} />}
        <DocsView
          onEditorReady={setEditor}
          readOnly={readOnly}
          commentsPanelOpen={commentsPanelOpen}
          onCommentsPanelOpenChange={setCommentsPanelOpen}
        />
      </div>
    </div>
  );
}

function SharedSlidesLayout({ resolved }: { resolved: ResolvedShareLink }) {
  // The share-link role decides whether the visitor gets the editing
  // toolbar + an interactive canvas, or a viewer-only mount with every
  // pointer/keyboard handler suppressed. Interaction gating lives in
  // `SlidesView` (which forwards `readOnly` to `initializeEditor`,
  // `mountThumbnailPanel`, and `mountNotesPanel`).
  const isMobile = useIsMobile();
  const readOnly = resolved.role === "viewer";

  // Phones (<768px) get the same mobile shell the owner route uses
  // (`slides-detail.tsx`): a full-height canvas with swipe nav and a
  // thumbnail strip instead of the desktop side panel. Read-only
  // viewers map to `mode="view"` (read-only SlideRenderer); editors map
  // to `mode="edit"`. Without this branch a viewer on a phone got the
  // cramped desktop `SlidesView` layout.
  if (isMobile) {
    return <SharedMobileSlidesLayout resolved={resolved} readOnly={readOnly} />;
  }

  return <SharedDesktopSlidesLayout resolved={resolved} readOnly={readOnly} />;
}

function SharedDesktopSlidesLayout({
  resolved,
  readOnly,
}: {
  resolved: ResolvedShareLink;
  readOnly: boolean;
}) {
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  const [currentThemeId, setCurrentThemeId] = useState("default-light");

  useEffect(() => {
    if (!store) return;
    setCurrentThemeId(store.read().meta.themeId);
    return store.onChange(() => {
      setCurrentThemeId(store.read().meta.themeId);
    });
  }, [store]);

  const activeTheme = useMemo<Theme | null>(() => {
    if (!store) return null;
    const doc = store.read();
    return doc.themes.find((t) => t.id === currentThemeId) ?? null;
  }, [store, currentThemeId]);

  // Image insert is gated on workspace-scoped auth (see image-upload.ts),
  // which share-link viewers don't have. Surface a toast instead of
  // silently dropping the click.
  const handleImagePick = useCallback(() => {
    toast.info("Image upload isn't available in shared editing.");
  }, []);

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          {readOnly && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              View only
            </span>
          )}
        </div>
        <UserPresence />
      </header>
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <Suspense fallback={<Loader />}>
          {!readOnly && (
            <SlidesToolbar
              editor={editor}
              store={store}
              theme={activeTheme}
              onImagePick={handleImagePick}
            />
          )}
          <SlidesView
            readOnly={readOnly}
            onEditorReady={setEditor}
            onStoreReady={setStore}
          />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * SharedMobileSlidesLayout — phone shell for a shared slides link.
 * Reuses `MobileSlidesView` (the same component the owner route mounts
 * on phones): `mode="view"` for read-only viewers, `mode="edit"` for
 * share-link editors. The toolbar only appears in edit mode, matching
 * both the desktop shared layout and the owner mobile layout.
 */
function SharedMobileSlidesLayout({
  resolved,
  readOnly,
}: {
  resolved: ResolvedShareLink;
  readOnly: boolean;
}) {
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  const [currentThemeId, setCurrentThemeId] = useState("default-light");

  useEffect(() => {
    if (!store) return;
    setCurrentThemeId(store.read().meta.themeId);
    return store.onChange(() => {
      setCurrentThemeId(store.read().meta.themeId);
    });
  }, [store]);

  const activeTheme = useMemo<Theme | null>(() => {
    if (!store) return null;
    const doc = store.read();
    return doc.themes.find((t) => t.id === currentThemeId) ?? null;
  }, [store, currentThemeId]);

  const handleImagePick = useCallback(() => {
    toast.info("Image upload isn't available in shared editing.");
  }, []);

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-medium">{resolved.title}</h1>
          {readOnly && (
            <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              View only
            </span>
          )}
        </div>
        <UserPresence />
      </header>
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <Suspense fallback={<Loader />}>
          {!readOnly && (
            <SlidesToolbar
              editor={editor}
              store={store}
              theme={activeTheme}
              onImagePick={handleImagePick}
            />
          )}
          <MobileSlidesView
            mode={readOnly ? "view" : "edit"}
            onEditorReady={setEditor}
            onStoreReady={setStore}
          />
        </Suspense>
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

  // The Yorkie document key namespaces the three document types so a
  // shared share-link routes the client to the same Yorkie document the
  // owner is editing — `doc-{id}` / `slides-{id}` / `sheet-{id}` mirror
  // the namespacing used by the per-type detail routes.
  const docKey =
    resolved.type === "doc"
      ? `doc-${resolved.documentId}`
      : resolved.type === "slides"
      ? `slides-${resolved.documentId}`
      : `sheet-${resolved.documentId}`;

  return (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: presence.username }}
    >
      {resolved.type === "doc" ? (
        <DocumentProvider<YorkieDocsRoot>
          docKey={docKey}
          initialRoot={initialDocsRoot()}
          initialPresence={presence}
          enableDevtools={import.meta.env.DEV}
        >
          <SharedDocsLayout resolved={resolved} />
        </DocumentProvider>
      ) : resolved.type === "slides" ? (
        <DocumentProvider<Partial<YorkieSlidesRoot>>
          docKey={docKey}
          initialRoot={{}}
          initialPresence={presence}
          enableDevtools={import.meta.env.DEV}
        >
          <SharedSlidesLayout resolved={resolved} />
        </DocumentProvider>
      ) : (
        <DocumentProvider
          docKey={docKey}
          initialRoot={initialSpreadsheetDocument()}
          initialPresence={presence}
          enableDevtools={import.meta.env.DEV}
        >
          <SharedDocumentLayout resolved={resolved} />
        </DocumentProvider>
      )}
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
