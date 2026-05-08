import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { YorkieSlidesRoot } from "@/types/slides-document";
import { SlidesView, type SlidesEditor } from "./slides-view";
import { SlidesFormattingToolbar } from "./slides-formatting-toolbar";
import { ThemePanel } from "./theme-panel";
import type { YorkieSlidesStore } from "./yorkie-slides-store";

/**
 * Initial Yorkie document root for a new slides presentation.
 * The root shape is fully populated lazily by `ensureSlidesRoot` on
 * first mount, so we only seed an empty root here.
 */
function initialSlidesRoot(): Partial<YorkieSlidesRoot> {
  return {};
}

/**
 * SlidesLayout — sidebar + header chrome around the slides editor.
 * Mirrors `DocsLayout` so the three document types share a single
 * visual language.
 */
function SlidesLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  // Track the active theme id so the panel highlights the right swatch
  // and re-renders on remote theme changes. Subscribed to `store.onChange`
  // below — local applies notify after the batch commits, remote applies
  // notify on the Yorkie subscription.
  const [currentThemeId, setCurrentThemeId] = useState("default-light");

  useEffect(() => {
    if (!store) return;
    setCurrentThemeId(store.read().meta.themeId);
    return store.onChange(() => {
      setCurrentThemeId(store.read().meta.themeId);
    });
  }, [store]);

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

  const { data: documentData, isError: isDocumentError } = useQuery({
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
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <SlidesFormattingToolbar
            editor={editor}
            onToggleThemePanel={() => setThemePanelOpen((v) => !v)}
            themePanelOpen={themePanelOpen}
          />
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <SlidesView
              onEditorReady={setEditor}
              onStoreReady={setStore}
              documentId={documentId}
            />
            {themePanelOpen && store && (
              <ThemePanel
                store={store}
                currentThemeId={currentThemeId}
                onClose={() => setThemePanelOpen(false)}
              />
            )}
          </div>
        </div>
      </SidebarInset>
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
        username: encodeURIComponent(currentUser.username),
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
