import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMe } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { toast } from "sonner";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import { usePresenceUpdater } from "@/hooks/use-presence-updater";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Theme } from "@wafflebase/slides";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import { MobileSlidesView } from "./mobile-slides-view";
import { SlidesView, type SlidesEditor } from "./slides-view";
import { SlidesToolbar } from "./toolbar";
import { SlidesPresentationMode } from "./slides-presentation-mode";
import { PresentButton } from "./slides-present-button";
import { SlidesExportButton } from "./slides-export-button";
import { uploadImageFile } from "../spreadsheet/image-upload";
import { insertImageOnSlide } from "./insert-image";
import { ThemePanel } from "./theme-panel";
import { FormatPanel } from "./format-panel";
import { MotionPanel } from "./motion-panel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { YorkieSlidesStore } from "./yorkie-slides-store";
import {
  createZoomController,
  FIT_ZOOM,
  type ZoomController,
} from "./zoom-controller";

/**
 * Initial Yorkie document root for a new slides presentation.
 * The root shape is fully populated lazily by `ensureSlidesRoot` on
 * first mount, so we only seed an empty root here.
 */
function initialSlidesRoot(): Partial<YorkieSlidesRoot> {
  return {};
}

/**
 * Resolve the slide id where a fresh presentation session should start.
 * `from === "first"` always returns the deck's first slide. `from ===
 * "current"` prefers the editor's active slide, falling back to the
 * first slide when the editor hasn't broadcast a selection yet (e.g.,
 * the user hit Cmd+Enter before clicking anywhere). Returns undefined
 * for an empty deck — the caller guards on that before mounting the
 * presenter.
 */
function resolveStartSlideId(
  store: YorkieSlidesStore,
  from: "current" | "first",
  editor: SlidesEditor | null,
): string | undefined {
  const slides = store.read().slides;
  if (slides.length === 0) return undefined;
  if (from === "first") return slides[0].id;
  return editor?.getCurrentSlideId() ?? slides[0].id;
}

/**
 * SlidesLayout — dispatches between the desktop chrome and the
 * read-only mobile shell based on viewport width, and owns the
 * shared document-not-found / permission guard that both branches
 * rely on. Hoisting the metadata fetch up here keeps mobile from
 * silently attaching to a Yorkie doc for an id the backend has
 * already rejected (without this, navigating to /p/<bad-id> on
 * mobile would create an empty deck instead of redirecting away).
 *
 * The mobile branch intentionally skips the desktop sidebar, site
 * header, toolbar, and SlidesView so a <768px viewport gets the
 * entire vertical space for the slide canvas (see
 * docs/design/slides/slides-mobile-view.md).
 */
function SlidesLayout({ documentId }: { documentId: string }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const {
    data: documentData,
    isError: isDocumentError,
    isLoading: isDocumentLoading,
  } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  // Resolve the fallback workspace slug for the redirect target, so
  // a not-found redirect lands the user back on their workspace's
  // document list rather than the global /documents page when
  // possible.
  const fallbackSlug =
    workspaces.find((w) => w.id === documentData?.workspaceId)?.slug ??
    workspaces[0]?.slug;

  useEffect(() => {
    if (isDocumentError) {
      toast.error("Document not found");
      navigate(fallbackSlug ? `/w/${fallbackSlug}` : "/documents", {
        replace: true,
      });
    }
  }, [isDocumentError, navigate, fallbackSlug]);

  // Gate the mount on the document existence check. Without this gate
  // both branches would mount during the loading window, kicking off
  // a Yorkie attach for the requested id before the backend has had
  // a chance to confirm the user is allowed to read it — a peer who
  // already had the deck open would briefly leak its contents
  // through the Yorkie subscription. Holding both branches behind
  // the loader closes that window; the error branch returns null
  // because the useEffect above is already racing toward the
  // redirect.
  if (isDocumentLoading) return <Loader />;
  if (isDocumentError) return null;

  if (isMobile) {
    return <MobileSlidesLayout documentId={documentId} />;
  }
  return <DesktopSlidesLayout documentId={documentId} />;
}

/**
 * DesktopSlidesLayout — sidebar + header chrome around the slides editor.
 * Mirrors `DocsLayout` so the three document types share a single
 * visual language.
 */
function DesktopSlidesLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  type RightPanel = "theme" | "format" | "motion" | null;
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  // Session-scoped zoom controller shared between SlidesView (drives
  // refitCanvas) and SlidesToolbar (renders the dropdown). useRef
  // keeps identity stable so the SlidesView mount effect's captured
  // controller stays valid across the lifetime of this layout.
  const zoomControllerRef = useRef<ZoomController>(
    createZoomController(FIT_ZOOM),
  );
  // Track the active theme id so the panel highlights the right swatch
  // and re-renders on remote theme changes. Subscribed to `store.onChange`
  // below — local applies notify after the batch commits, remote applies
  // notify on the Yorkie subscription.
  const [currentThemeId, setCurrentThemeId] = useState("default-light");
  // `presentingFrom` is the present-mode state machine: null while
  // editing, 'current' | 'first' while a session is mounted. Flipping
  // to a non-null value mounts <SlidesPresentationMode>; the presenter's
  // onExit flips it back to null.
  const [presentingFrom, setPresentingFrom] = useState<
    "current" | "first" | null
  >(null);
  // Mirror the deck size so the Present button can disable itself when
  // the deck momentarily holds zero slides (before the editor seeds its
  // initial slide). Re-evaluated on every store change.
  const [slideCount, setSlideCount] = useState(0);

  useEffect(() => {
    if (!store) return;
    setCurrentThemeId(store.read().meta.themeId);
    return store.onChange(() => {
      setCurrentThemeId(store.read().meta.themeId);
    });
  }, [store]);

  useEffect(() => {
    if (!store) {
      setSlideCount(0);
      return;
    }
    setSlideCount(store.getSlideCount());
    return store.onChange(() => {
      setSlideCount(store.getSlideCount());
    });
  }, [store]);

  const handleStartPresentation = useCallback(
    (from: "current" | "first") => {
      if (!store) return;
      if (store.read().slides.length === 0) return;
      setPresentingFrom(from);
    },
    [store],
  );

  // Resolve the active Theme object — fed to the contextual color and
  // font pickers in the toolbar so their "Theme" rows match the deck.
  // Falls back to null while the store hasn't loaded or the active
  // theme is unknown (the toolbar disables its pickers when null).
  const activeTheme = useMemo<Theme | null>(() => {
    if (!store) return null;
    const doc = store.read();
    return doc.themes.find((t) => t.id === currentThemeId) ?? null;
  }, [store, currentThemeId]);

  // Clean up stale pointer-events on body left by Radix Sheet from a
  // previous route (e.g. Layout's mobile sidebar unmounting mid-animation).
  useEffect(() => {
    document.body.style.removeProperty("pointer-events");
    return () => {
      document.body.style.removeProperty("pointer-events");
    };
  }, []);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // The not-found / permission redirect lives in `SlidesLayout` (the
  // parent) so the mobile branch enforces the same guard. The query
  // call below reuses react-query's cache — same key as the parent's
  // — so no second network request is issued.
  const { data: documentData } = useQuery({
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

  const items = useMemo(() => {
    const wsRoot = workspaceSlug ? `/w/${workspaceSlug}` : "/documents";
    const dsRoot = workspaceSlug
      ? `/w/${workspaceSlug}/datasources`
      : "/datasources";
    const stRoot = workspaceSlug
      ? `/w/${workspaceSlug}/settings`
      : "/settings";
    return {
      main: [
        { title: "Documents", url: wsRoot, icon: IconFolder },
        { title: "Data Sources", url: dsRoot, icon: IconDatabase },
        { title: "Settings", url: stRoot, icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug]);

  const handleWorkspaceChange = useCallback(
    (slug: string) => navigate(`/w/${slug}`),
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

  // Upload pipeline: wraps the workspace image API to match the shape
  // expected by SlidesToolbar (and insert-image / replace-image helpers).
  const workspaceId = documentData?.workspaceId;
  const uploadFn = useCallback(
    async (file: File): Promise<{ url: string; w: number; h: number }> => {
      if (!workspaceId) throw new Error("Workspace not loaded yet");
      const result = await uploadImageFile(file, workspaceId);
      return { url: result.url, w: result.width, h: result.height };
    },
    [workspaceId],
  );

  // Opens a file picker and inserts the chosen image into the current slide.
  const handleImagePick = useCallback(async () => {
    if (!store || !workspaceId) return;
    const slideId = editor?.getCurrentSlideId();
    if (!slideId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await insertImageOnSlide({ store, slideId, file, upload: uploadFn });
      } catch (err) {
        console.error("Failed to insert image", err);
        toast.error("Failed to insert image");
      }
    };
    input.click();
  }, [store, editor, uploadFn, workspaceId]);

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
            <PresentButton
              disabled={!store || slideCount === 0}
              onStart={handleStartPresentation}
            />
            <SlidesExportButton
              store={store}
              title={documentData?.title ?? "presentation"}
              disabled={!store || slideCount === 0}
            />
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <SlidesToolbar
            editor={editor}
            store={store}
            theme={activeTheme}
            onImagePick={handleImagePick}
            upload={uploadFn}
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
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <SlidesView
              onEditorReady={setEditor}
              onStoreReady={setStore}
              onStartPresentation={handleStartPresentation}
              documentId={documentId}
              zoomController={zoomControllerRef.current}
              uploadImage={uploadFn}
            />
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
        </div>
      </SidebarInset>
      {presentingFrom &&
        store &&
        (() => {
          // resolveStartSlideId returns undefined when the deck is
          // empty. `presentingFrom` is gated on the empty-deck check
          // in `handleStartPresentation`, but a remote peer can empty
          // the deck between `setPresentingFrom(...)` and the next
          // render — the conditional would otherwise reach here with
          // an undefined start id. Guard explicitly instead of using
          // a non-null assertion.
          const startSlideId = resolveStartSlideId(
            store,
            presentingFrom,
            editor,
          );
          if (!startSlideId) return null;
          return (
            <SlidesPresentationMode
              store={store}
              startSlideId={startSlideId}
              onExit={() => {
                // The presenter calls onExit for several reasons (Esc, end-
                // screen click, native fullscreen exit, empty deck). We
                // can't ask which — but if the deck is empty right now,
                // the empty-deck branch of setDocument is what called us.
                if (store.read().slides.length === 0) {
                  toast.info("Presentation ended (deck is empty)");
                }
                setPresentingFrom(null);
              }}
            />
          );
        })()}
    </SidebarProvider>
  );
}

/** Titles + sr-only descriptions for the mobile design/format bottom sheets. */
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
 * MobileSlidesLayout — same chrome as `DesktopSlidesLayout` (sidebar
 * drawer + SiteHeader + SlidesToolbar) but mounts `MobileSlidesView`
 * instead of `SlidesView` for the canvas. The toolbar collapses to its
 * mobile branch (undo/redo + SlideGroup + overflow) inside
 * `SlidesToolbar` based on `useIsMobile()`.
 *
 * Keep in sync with `DesktopSlidesLayout` for the workspace + rename +
 * Present + theme state — the two diverge only in the canvas mount and
 * the absence of the theme panel side-drawer (mobile defers that to
 * Phase B-1). When this drift grows, extract a `useSlidesShellState`
 * hook (todo: `docs/tasks/active/20260519-slides-mobile-shell-todo.md`).
 */
function MobileSlidesLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  const [presentingFrom, setPresentingFrom] = useState<
    "current" | "first" | null
  >(null);
  const [slideCount, setSlideCount] = useState(0);
  // Which design/format panel is open as a bottom sheet. Mirrors the
  // desktop `rightPanel` side-drawer state machine, but the panels render
  // inside a `Sheet` instead of docking next to the canvas.
  type RightPanel = "theme" | "format" | "motion" | null;
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const panelMeta = rightPanel ? MOBILE_PANEL_META[rightPanel] : null;
  // Mirror the active theme so the Format sheet's theme-bound pickers
  // (shape fill, text color, font family) get a non-null Theme to
  // resolve against. Without this they are gated behind a `!theme`
  // disabled state and silently no-op for mobile users.
  const [currentThemeId, setCurrentThemeId] = useState("default-light");

  useEffect(() => {
    if (!store) {
      setSlideCount(0);
      return;
    }
    setSlideCount(store.getSlideCount());
    return store.onChange(() => {
      setSlideCount(store.getSlideCount());
    });
  }, [store]);

  useEffect(() => {
    if (!store) return;
    setCurrentThemeId(store.read().meta.themeId);
    return store.onChange(() => {
      setCurrentThemeId(store.read().meta.themeId);
    });
  }, [store]);

  // Resolve the active Theme object — fed to the Format sheet so its
  // contextual color and font pickers can render the deck's themed
  // swatches and font tokens.
  const activeTheme = useMemo<Theme | null>(() => {
    if (!store) return null;
    const doc = store.read();
    return doc.themes.find((t) => t.id === currentThemeId) ?? null;
  }, [store, currentThemeId]);

  const handleStartPresentation = useCallback(
    (from: "current" | "first") => {
      if (!store) return;
      if (store.read().slides.length === 0) return;
      setPresentingFrom(from);
    },
    [store],
  );

  // Clean up stale pointer-events on body left by Radix Sheet from a
  // previous route (e.g. Layout's mobile sidebar unmounting mid-animation).
  useEffect(() => {
    document.body.style.removeProperty("pointer-events");
    return () => {
      document.body.style.removeProperty("pointer-events");
    };
  }, []);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: documentData } = useQuery({
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

  const items = useMemo(() => {
    const wsRoot = workspaceSlug ? `/w/${workspaceSlug}` : "/documents";
    const dsRoot = workspaceSlug
      ? `/w/${workspaceSlug}/datasources`
      : "/datasources";
    const stRoot = workspaceSlug
      ? `/w/${workspaceSlug}/settings`
      : "/settings";
    return {
      main: [
        { title: "Documents", url: wsRoot, icon: IconFolder },
        { title: "Data Sources", url: dsRoot, icon: IconDatabase },
        { title: "Settings", url: stRoot, icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug]);

  const handleWorkspaceChange = useCallback(
    (slug: string) => navigate(`/w/${slug}`),
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

  // Image upload pipeline. Mobile toolbar does not surface an Insert
  // Image entry in Phase B-0, but the SlidesToolbar prop signature
  // expects an `upload` function regardless — pass the same workspace
  // pipeline desktop uses so future toolbar items wire up for free.
  const workspaceId = documentData?.workspaceId;
  const uploadFn = useCallback(
    async (file: File): Promise<{ url: string; w: number; h: number }> => {
      if (!workspaceId) throw new Error("Workspace not loaded yet");
      const result = await uploadImageFile(file, workspaceId);
      return { url: result.url, w: result.width, h: result.height };
    },
    [workspaceId],
  );

  const handleImagePick = useCallback(async () => {
    if (!store || !workspaceId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      // Resolve the slide AFTER the picker returns — the user could
      // have swiped to a different slide while the native picker UI
      // was open, and inserting into the slide that was current at
      // open-time would surprise them.
      const slideId = editor?.getCurrentSlideId();
      if (!slideId) return;
      const file = input.files?.[0];
      if (!file) return;
      try {
        await insertImageOnSlide({ store, slideId, file, upload: uploadFn });
      } catch (err) {
        console.error("Failed to insert image", err);
        toast.error("Failed to insert image");
      }
    };
    input.click();
  }, [store, editor, uploadFn, workspaceId]);

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
            <PresentButton
              disabled={!store || slideCount === 0}
              onStart={handleStartPresentation}
            />
            <SlidesExportButton
              store={store}
              title={documentData?.title ?? "presentation"}
              disabled={!store || slideCount === 0}
            />
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <SlidesToolbar
            editor={editor}
            store={store}
            theme={activeTheme}
            onImagePick={handleImagePick}
            upload={uploadFn}
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
          <MobileSlidesView
            mode="edit"
            onStoreReady={setStore}
            onEditorReady={setEditor}
          />
        </div>
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
          </SheetContent>
        </Sheet>
      </SidebarInset>
      {presentingFrom &&
        store &&
        (() => {
          const startSlideId = resolveStartSlideId(
            store,
            presentingFrom,
            editor,
          );
          if (!startSlideId) return null;
          return (
            <SlidesPresentationMode
              store={store}
              startSlideId={startSlideId}
              onExit={() => {
                if (store.read().slides.length === 0) {
                  toast.info("Presentation ended (deck is empty)");
                }
                setPresentingFrom(null);
              }}
            />
          );
        })()}
    </SidebarProvider>
  );
}

/**
 * SlidesDetail wraps the slides editor with a Yorkie DocumentProvider,
 * mirroring `DocsDetail`: authenticate the user, then keyed-attach the
 * Yorkie document and let `SlidesLayout` mount the chrome + editor.
 *
 * The Phase 4a route is `/p/:id`; the document key follows the same
 * `slides-{id}` namespacing pattern as docs uses (`doc-{id}`) so the
 * three document types (sheet, doc, slides) never collide on Yorkie.
 */
export function SlidesDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Loader />;
  if (isError || !currentUser) return <Navigate to="/login" replace />;
  if (!currentUser.username || !currentUser.email) return <Loader />;

  return (
    <DocumentProvider
      docKey={`slides-${id}`}
      initialRoot={initialSlidesRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <SlidesLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default SlidesDetail;
