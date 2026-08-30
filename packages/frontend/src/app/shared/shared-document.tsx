import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { YorkieProvider, DocumentProvider, useDocument } from "@yorkie-js/react";
import { toast } from "sonner";
import { resolveShareLink, ResolvedShareLink } from "@/api/share-links";
import { fetchMeOptional, fetchYorkieShareToken } from "@/api/auth";
import { Loader } from "@/components/loader";
import { SharedHeaderStatus } from "@/app/shared/shared-header-status";
import SheetView from "@/app/spreadsheet/sheet-view";
import {
  SpreadsheetDocument,
  TabMeta,
  sheetsInitialRootForRole,
} from "@/types/worksheet";
import {
  docsInitialRootForRole,
  type YorkieDocsRoot,
} from "@/types/docs-document";
import {
  notesInitialRootForRole,
  noteUserColor,
  type YorkieNotesRoot,
} from "@/types/notes-document";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import {
  boardInitialRootForRole,
  type YorkieBoardRoot,
} from "@/types/board-document";
import type { UserPresence as UserPresenceType } from "@/types/users";
import { UserPresence } from "@/components/user-presence";
import { useIsMobile } from "@/hooks/use-mobile";
import { useViewAnalytics } from "@/hooks/use-view-analytics";
import { DocsView, type EditorAPI } from "@/app/docs/docs-view";
import { NotesView } from "@/app/notes/notes-view";
import {
  PdfCollabProvider,
  PdfHeaderActions,
  PdfCollabBody,
  type PdfPresenceUser,
} from "@/app/files/pdf-collab";
import { ImageViewer } from "@/app/files/image-viewer";
import { GenericFileView } from "@/app/files/generic-file-view";
import { fileUrl } from "@/api/files";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { DocsFormattingToolbar } from "@/app/docs/docs-formatting-toolbar";
import type { SlidesEditor, Theme } from "@wafflebase/slides";
import { setImageUrlResolver as setSlidesImageUrlResolver } from "@wafflebase/slides";
import { appendShareTokenToImageUrl } from "@/api/share-image-url";
import type { YorkieSlidesStore } from "@/app/slides/yorkie-slides-store";
import {
  createZoomController,
  FIT_ZOOM,
  type ZoomController,
} from "@/app/slides/zoom-controller";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  IconBuildingWarehouse,
  IconDatabase,
  IconMessage,
  IconTable,
} from "@tabler/icons-react";

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

/**
 * A shared spreadsheet whose workbook has no sheets yet. Reachable when the
 * document was created through the API and shared before anyone opened it,
 * so no client has ever written its root.
 */
function SharedEmptySpreadsheet({ title }: { title: string }) {
  return (
    <div className="flex h-screen w-full items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">
          This spreadsheet has no sheets yet. It will appear here once
          someone with edit access opens it.
        </p>
      </div>
    </div>
  );
}

/**
 * Lakehouse endpoints require JWT workspace membership. This placeholder
 * avoids fetchWithAuth redirecting anonymous share-link viewers to /login.
 */
function SharedLakehouseUnavailable() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-2">
        <h2 className="text-sm font-medium">
          Lakehouse data is unavailable in shared links
        </h2>
        <p className="text-sm text-muted-foreground">
          Open this document from its authenticated workspace to read the
          connected table.
        </p>
      </div>
    </div>
  );
}

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

// Board reuses the same heavy @wafflebase/slides editor bundle as an
// infinite canvas (see board-view.tsx). Lazy-load it for the same reason
// as SlidesView — non-board share links shouldn't pay the cost.
const BoardView = lazy(() =>
  import("@/app/board/board-view").then((module) => ({
    default: module.BoardView,
  })),
);

// Right-side editing panels. Lazy-loaded so non-slides share links (and
// read-only slides viewers) don't pull the slides editing chunk.
const ThemePanel = lazy(() =>
  import("@/app/slides/theme-panel").then((module) => ({
    default: module.ThemePanel,
  })),
);

const FormatPanel = lazy(() =>
  import("@/app/slides/format-panel").then((module) => ({
    default: module.FormatPanel,
  })),
);

const MotionPanel = lazy(() =>
  import("@/app/slides/motion-panel").then((module) => ({
    default: module.MotionPanel,
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

  // A workbook with no tabs is not a blank grid, it is no grid — and
  // `activeTabId` can only be null because there is nothing to select. The
  // bare loader here spun forever in that state; it was unreachable only
  // because every visitor, viewer included, seeded a `Sheet1` from their own
  // client on attach. Viewers no longer do, so the case needs an exit.
  if (!activeTabId) {
    return tabs.length === 0 ? (
      <SharedEmptySpreadsheet title={resolved.title} />
    ) : (
      <Loader />
    );
  }

  const activeTab = root.tabs[activeTabId];

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          <SharedHeaderStatus readOnly={readOnly} />
        </div>
        <UserPresence onSelectPeer={handleSelectPeer} getJumpHint={getJumpHint} />
      </header>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col">
          <Suspense fallback={<Loader />}>
            {activeTab?.type === "datasource" ? (
              <DataSourceView tabId={activeTabId} readOnly={readOnly} />
            ) : activeTab?.type === "lakehouse" ? (
              <SharedLakehouseUnavailable />
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
              aria-current={tab.id === activeTabId ? "page" : undefined}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.type === "datasource" ? (
                <IconDatabase className="size-3.5" />
              ) : tab.type === "lakehouse" ? (
                <IconBuildingWarehouse className="size-3.5" />
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
          <SharedHeaderStatus readOnly={readOnly} />
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

function SharedNotesLayout({ resolved }: { resolved: ResolvedShareLink }) {
  const readOnly = resolved.role === "viewer";

  useEffect(() => {
    document.title = resolved.title
      ? `${resolved.title} — Wafflebase`
      : "Wafflebase";
  }, [resolved.title]);

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          <SharedHeaderStatus readOnly={readOnly} />
        </div>
        <UserPresence />
      </header>
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {/*
          No `showAuthors`: this surface has no view menu, so `NotesView` falls
          back to the visitor's own stored preference. Passing it from here
          would mean importing `notes-settings` into this route too, which
          makes Rollup hoist it — and the notes engine with it — into a shared
          chunk well past the chunk-size gate.
        */}
        {/*
          `both` on a phone is a fixed 50/50 split, so ~187px per pane — bad,
          and deliberately kept. This surface mounts no toolbar, so the split
          is the only thing that renders a preview at all here; demoting it to
          `edit` on narrow screens would trade a cramped preview for no
          preview, with nothing to switch back with. Fixing it properly means
          giving this route its own mode control, which is more than a layout
          change. See docs/design/notes/notes.md.
        */}
        <NotesView readOnly={readOnly} viewMode={readOnly ? "view" : "both"} />
      </div>
    </div>
  );
}

/**
 * Shared board layout — simplest of the shared layouts: no per-type
 * toolbar/panel machinery, mirroring `SharedNotesLayout`'s header + content
 * shape. `BoardView`'s `readOnly` prop forwards straight into
 * `initializeEditor({ readOnly })` (same mechanism `SlidesView` uses), so a
 * viewer-role share link gets a canvas that paints (including remote peer
 * edits) but accepts no pointer/keyboard input — matching the "View only"
 * badge instead of just displaying it.
 */
function SharedBoardLayout({ resolved }: { resolved: ResolvedShareLink }) {
  const readOnly = resolved.role === "viewer";

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          <SharedHeaderStatus readOnly={readOnly} />
        </div>
        <UserPresence />
      </header>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<Loader />}>
          <BoardView documentId={resolved.documentId} readOnly={readOnly} />
        </Suspense>
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
  // Which right-side editing panel is docked. Mirrors the owner route
  // (`slides-detail.tsx`) so editor share links get the same theme /
  // format / motion panels. Stays null (unused) for read-only viewers.
  type RightPanel = "theme" | "format" | "motion" | null;
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  // Session-scoped zoom controller shared between SlidesView (drives
  // refitCanvas) and SlidesToolbar (renders the dropdown). useRef keeps
  // identity stable across the layout's lifetime.
  const zoomControllerRef = useRef<ZoomController>(
    createZoomController(FIT_ZOOM),
  );

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
          <SharedHeaderStatus readOnly={readOnly} />
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
              onToggleThemePanel={() =>
                setRightPanel((p) => (p === "theme" ? null : "theme"))
              }
              themePanelOpen={rightPanel === "theme"}
              onToggleFormatPanel={() =>
                setRightPanel((p) => (p === "format" ? null : "format"))
              }
              formatPanelOpen={rightPanel === "format"}
              onToggleMotionPanel={() =>
                setRightPanel((p) => (p === "motion" ? null : "motion"))
              }
              motionPanelOpen={rightPanel === "motion"}
              zoomController={zoomControllerRef.current}
            />
          )}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <SlidesView
              readOnly={readOnly}
              onEditorReady={setEditor}
              onStoreReady={setStore}
              zoomController={zoomControllerRef.current}
            />
            {/* rightPanel is only ever set by the toolbar above, which is
                gated on !readOnly — so these never render for a viewer. */}
            {rightPanel === "theme" && store && (
              <ThemePanel
                store={store}
                currentThemeId={currentThemeId}
                onClose={() => setRightPanel(null)}
              />
            )}
            {rightPanel === "format" && store && editor && (
              <FormatPanel
                store={store}
                editor={editor}
                onClose={() => setRightPanel(null)}
              />
            )}
            {rightPanel === "motion" && store && editor && (
              <MotionPanel
                store={store}
                editor={editor}
                onClose={() => setRightPanel(null)}
              />
            )}
          </div>
        </Suspense>
      </div>
    </div>
  );
}

/** Titles + sr-only descriptions for the mobile editing bottom sheets. */
const MOBILE_PANEL_META = {
  theme: {
    title: "Theme",
    description: "Pick a built-in theme for the deck.",
  },
  format: {
    title: "Format options",
    description: "Edit size, position, and effects for the selected object.",
  },
  motion: {
    title: "Motion",
    description: "Configure slide transitions and object animations.",
  },
} as const;

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
  // Which editing panel is open as a bottom sheet — mirrors the owner
  // mobile route so editor share links get theme / format / motion.
  type RightPanel = "theme" | "format" | "motion" | null;
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const panelMeta = rightPanel ? MOBILE_PANEL_META[rightPanel] : null;

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
          <SharedHeaderStatus readOnly={readOnly} />
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
              onToggleThemePanel={() =>
                setRightPanel((p) => (p === "theme" ? null : "theme"))
              }
              themePanelOpen={rightPanel === "theme"}
              onToggleFormatPanel={() =>
                setRightPanel((p) => (p === "format" ? null : "format"))
              }
              formatPanelOpen={rightPanel === "format"}
              onToggleMotionPanel={() =>
                setRightPanel((p) => (p === "motion" ? null : "motion"))
              }
              motionPanelOpen={rightPanel === "motion"}
            />
          )}
          <MobileSlidesView
            mode={readOnly ? "view" : "edit"}
            onEditorReady={setEditor}
            onStoreReady={setStore}
          />
        </Suspense>
      </div>
      {!readOnly && (
        <Sheet
          open={rightPanel !== null}
          onOpenChange={(o) => {
            if (!o) setRightPanel(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[80vh] gap-0 p-0 pb-[env(safe-area-inset-bottom,8px)]"
          >
            <SheetHeader className="border-b">
              <SheetTitle>{panelMeta?.title}</SheetTitle>
              <SheetDescription className="sr-only">
                {panelMeta?.description}
              </SheetDescription>
            </SheetHeader>
            <Suspense fallback={<Loader />}>
              {rightPanel === "theme" && store && (
                <ThemePanel
                  variant="sheet"
                  store={store}
                  currentThemeId={currentThemeId}
                  onClose={() => setRightPanel(null)}
                />
              )}
              {rightPanel === "format" && store && editor && (
                <FormatPanel
                  variant="sheet"
                  store={store}
                  editor={editor}
                  onClose={() => setRightPanel(null)}
                />
              )}
              {rightPanel === "motion" && store && editor && (
                <MotionPanel
                  variant="sheet"
                  store={store}
                  editor={editor}
                  onClose={() => setRightPanel(null)}
                />
              )}
            </Suspense>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/**
 * Shared PDF layout — mounts its own public-key YorkieProvider (anonymous
 * viewers) + the `pdf-<id>` DocumentProvider, and lays out a bare top bar
 * with the comment/presence controls, mirroring `SharedDocsLayout`. The PDF
 * bytes are fetched with the share token; comments + presence flow through
 * Yorkie.
 */
function SharedPdfLayout({
  resolved,
  token,
  presenceUser,
}: {
  resolved: ResolvedShareLink;
  token?: string;
  presenceUser: PdfPresenceUser;
}) {
  const readOnly = resolved.role === "viewer";
  return (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: presenceUser.username }}
      authTokenInjector={token ? () => fetchYorkieShareToken(token) : undefined}
    >
      <PdfCollabProvider
        documentId={resolved.documentId}
        readOnly={readOnly}
        token={token}
        presenceUser={presenceUser}
      >
        <div className="flex h-screen w-full flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-medium">{resolved.title}</h1>
              {/* Deliberately NOT `SharedHeaderStatus`, which every other
                  shared layout uses. It would work here — the comment
                  `DocumentProvider` does wrap this header — but the owned PDF
                  route (`app/files/file-shell.tsx`) mounts no provider and
                  cannot have it, and one document type whose sync chip depends
                  on which URL you opened is worse than one with none. PDF is
                  uniformly out of scope; see docs/design/sync-status.md. */}
              {readOnly && (
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  View only
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <PdfHeaderActions />
              <UserPresence />
            </div>
          </header>
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
            <PdfCollabBody />
          </div>
        </div>
      </PdfCollabProvider>
    </YorkieProvider>
  );
}

/**
 * Shared layout for blob documents with no CRDT: rendered outside the
 * YorkieProvider entirely, since there is nothing to attach.
 *
 * `GenericFileView` tells the viewer to "Use Download in the header" — that
 * instruction is only true if the header actually has a download control, so
 * one is rendered here, mirroring `DownloadFileButton` in `file-detail.tsx`
 * (same icon-ghost-button treatment) but as a plain anchor at the
 * already-token-aware, permission-gated `fileUrl`, since an anonymous share
 * viewer can't use `downloadDocumentFile`'s `fetchWithAuth` call. For a
 * `file` document the backend sends `Content-Disposition: attachment`, so
 * this always saves the file regardless of origin. For an `image` document
 * the backend sends `inline`; in dev, frontend and backend are different
 * origins, so the `download` attribute is ignored there and the anchor just
 * navigates to the image — acceptable, since the viewer above already shows
 * it and the browser's own save works from there.
 */
function SharedBlobLayout({
  resolved,
  token,
}: {
  resolved: ResolvedShareLink;
  token?: string;
}) {
  return (
    <div className="flex h-svh flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="font-medium">{resolved.title}</span>
        <Button asChild variant="ghost" size="icon">
          <a
            href={fileUrl(resolved.documentId, token)}
            download
            aria-label="Download file"
            title="Download file"
          >
            <Download className="h-4 w-4" />
          </a>
        </Button>
      </div>
      {resolved.type === "image" ? (
        <ImageViewer documentId={resolved.documentId} token={token} />
      ) : (
        <GenericFileView title={resolved.title} />
      )}
    </div>
  );
}

/**
 * How a shared document should be mounted.
 *
 * `pdf` has its own Yorkie-backed layout (comments + presence). `image` and
 * `file` are blobs with no CRDT at all, so they must mount NO Yorkie document
 * — before this existed they matched no branch and fell through to the
 * `sheet-<id>` fallback, rendering an empty spreadsheet over a real image.
 */
export function sharedBlobKind(type: string): "pdf" | "blob" | "crdt" {
  if (type === "pdf") return "pdf";
  if (type === "image" || type === "file") return "blob";
  return "crdt";
}

/**
 * Install the share-token image-URL resolver on the slides engine (which
 * renders both `slides` and `board`) for the lifetime of the shared mount.
 * Other types render no slides-engine workspace image, so the hook no-ops:
 * `doc` uploads to the unauthenticated legacy `/images/:id` route (nothing to
 * token), and pdf/image/file/note don't paint through this engine.
 *
 * Installed in a commit-phase `useLayoutEffect`, not during render: a
 * render-phase mutation of the module-level singleton could be clobbered by an
 * abandoned/concurrent render. A layout effect still runs before the slides
 * canvas's first draw — the canvas paints from a passive `useEffect` /
 * `requestAnimationFrame` (see slides-view), and all layout effects run before
 * any passive effect — so the token is in place before the first image load
 * and no un-tokened 403 is fired. Cleanup clears the singleton on unmount and
 * pairs correctly with StrictMode's dev mount→cleanup→remount.
 */
function useSharedImageTokenResolver(type: string, token?: string): void {
  const isSlidesEngine = type === "slides" || type === "board";
  const resolver = useMemo(
    () =>
      isSlidesEngine && token
        ? (src: string) => appendShareTokenToImageUrl(src, token)
        : null,
    [isSlidesEngine, token],
  );
  useLayoutEffect(() => {
    if (!resolver) return;
    setSlidesImageUrlResolver(resolver);
    return () => setSlidesImageUrlResolver(null);
  }, [resolver]);
}

function SharedDocumentInner({
  resolved,
  token,
}: {
  resolved: ResolvedShareLink;
  token?: string;
}) {
  const { data: currentUser } = useQuery({
    queryKey: ["me", "optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  // A stable per-session id for anonymous share viewers. Comment ownership
  // (CommentThreadCard's edit/delete gate) compares `author.userId ===
  // currentUserId`, so a shared `""` fallback would let every anonymous
  // editor-link guest edit and delete each other's comments. A unique id per
  // session scopes edit/delete to the guest's own comments.
  const anonUserId = useMemo(() => `anon-${crypto.randomUUID()}`, []);

  // Both viewer and editor share-link access count as a view; this mounts
  // once per SharedDocumentInner render (all document types, including the
  // early `pdf` return below), so exactly one session is recorded per visit.
  useViewAnalytics({ shareToken: token ?? "", enabled: Boolean(token) });

  // Images embedded in a slides / board document are fetched over a plain
  // image request that carries no share credential, so an anonymous viewer
  // would otherwise get 403s and an "Image unavailable" placeholder. Install
  // a resolver that appends this viewer's `?token=` to workspace image URLs
  // at render time. Called unconditionally (before the pdf/blob early returns
  // below) to keep hook order stable; it no-ops for types with no such image.
  useSharedImageTokenResolver(resolved.type, token);

  // SharedPdfLayout mounts its own YorkieProvider/DocumentProvider, and
  // SharedBlobLayout mounts no Yorkie document at all, so both must render
  // before the shared provider wrapper below rather than nested inside it
  // (nesting would create two competing Yorkie connections, or attach one
  // that has nothing to represent).
  const kind = sharedBlobKind(resolved.type);
  if (kind === "pdf") {
    return (
      <SharedPdfLayout
        resolved={resolved}
        token={token}
        presenceUser={{
          userId: currentUser?.id != null ? String(currentUser.id) : anonUserId,
          username: currentUser?.username || "Anonymous",
          email: currentUser?.email || "",
          photo: currentUser?.photo || "",
        }}
      />
    );
  }
  if (kind === "blob") {
    return <SharedBlobLayout resolved={resolved} token={token} />;
  }

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
      : resolved.type === "note"
      ? `note-${resolved.documentId}`
      : resolved.type === "board"
      ? `board-${resolved.documentId}`
      : `sheet-${resolved.documentId}`;

  return (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: presence.username }}
      authTokenInjector={token ? () => fetchYorkieShareToken(token) : undefined}
    >
      {resolved.type === "doc" ? (
        <DocumentProvider<YorkieDocsRoot>
          docKey={docKey}
          // A viewer must not seed the root. The SDK writes every
          // `initialRoot` key the document does not already have, on each
          // attach — so a viewer opening a share link to a never-edited
          // document created `content` and `comments` from their own client.
          // Nothing a viewer can do needs either key: every `root.comments`
          // read is existence-guarded (`yorkie-comment-store.ts`), an
          // editor's first comment creates the container lazily, and viewers
          // cannot add comments at all. The LWW argument for seeding
          // `comments` is about two *editors* racing on the first comment,
          // and editors still seed.
          initialRoot={docsInitialRootForRole(resolved.role)}
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
      ) : resolved.type === "note" ? (
        <DocumentProvider<Partial<YorkieNotesRoot>>
          docKey={docKey}
          initialRoot={notesInitialRootForRole(resolved.role)}
          initialPresence={{
            ...presence,
            color: noteUserColor(presence.username),
            name: presence.username,
            selection: null,
            cursor: null,
          }}
          enableDevtools={import.meta.env.DEV}
        >
          <SharedNotesLayout resolved={resolved} />
        </DocumentProvider>
      ) : resolved.type === "board" ? (
        <DocumentProvider<Partial<YorkieBoardRoot>>
          docKey={docKey}
          initialRoot={boardInitialRootForRole(resolved.role)}
          initialPresence={{
            ...presence,
            selectedElementIds: [],
            cursor: null,
          }}
          enableDevtools={import.meta.env.DEV}
        >
          <SharedBoardLayout resolved={resolved} />
        </DocumentProvider>
      ) : (
        <DocumentProvider
          docKey={docKey}
          initialRoot={sheetsInitialRootForRole(resolved.role)}
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

  return <SharedDocumentInner resolved={resolved} token={token} />;
}

export default SharedDocument;
