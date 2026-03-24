import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMe } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import { usePresenceUpdater } from "@/hooks/use-presence-updater";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { DocsView, type EditorAPI } from "./docs-view";
import { DocsFormattingToolbar } from "./docs-formatting-toolbar";

/**
 * Initial Yorkie document root for a new docs document.
 * Note: Tree CRDT must be created via `new yorkie.Tree()` inside
 * doc.update(), so we only provide an empty root here. DocsView
 * initializes the Tree when it detects `content` is missing.
 */
function initialDocsRoot(): Partial<YorkieDocsRoot> {
  return {};
}

/**
 * DocsLayout provides the sidebar + header chrome around the docs editor,
 * matching the same layout structure as the spreadsheet's DocumentLayout.
 */
function DocsLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const [editor, setEditor] = useState<EditorAPI | null>(null);

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
          <DocsFormattingToolbar editor={editor} />
          <DocsView onEditorReady={setEditor} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * DocsDetail wraps the document editor with a Yorkie DocumentProvider,
 * handling authentication and providing the collaborative document context.
 */
export function DocsDetail() {
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

  if (isLoading) {
    return <Loader />;
  }

  if (isError || !currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (!currentUser.username || !currentUser.email) {
    return <Loader />;
  }

  return (
    <DocumentProvider
      docKey={`doc-${id}`}
      initialRoot={initialDocsRoot()}
      initialPresence={{
        username: encodeURIComponent(currentUser.username),
        email: currentUser.email,
        photo: currentUser.photo || "",
        activeCursorPos: undefined,
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <DocsLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default DocsDetail;
