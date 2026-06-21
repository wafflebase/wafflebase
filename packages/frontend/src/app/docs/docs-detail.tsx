import { DocumentProvider, useDocument } from "@yorkie-js/react";
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
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePresenceUpdater } from "@/hooks/use-presence-updater";
import { IconFolder, IconSettings, IconDatabase, IconMessage } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { initialDocsRoot, type YorkieDocsRoot } from "@/types/docs-document";
import type { DocsPresence } from "@/types/users";
import type { EditContext } from "@wafflebase/docs";
import { DocsView, type EditorAPI, type JumpHandle } from "./docs-view";
import { DocsExportButton } from "./docs-export-button";
import { DocsFormattingToolbar } from "./docs-formatting-toolbar";


/**
 * DocsLayout provides the sidebar + header chrome around the docs editor,
 * matching the same layout structure as the spreadsheet's DocumentLayout.
 */
function DocsLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();
  const [editor, setEditor] = useState<EditorAPI | null>(null);
  const [editContext, setEditContext] = useState<EditContext>('body');
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);

  const { doc } = useDocument<YorkieDocsRoot, DocsPresence>();
  const [jumpHandle, setJumpHandle] = useState<JumpHandle | null>(null);

  const handleSelectPeer = useCallback(
    (clientID: string) => {
      jumpHandle?.jumpToPeer(clientID);
    },
    [jumpHandle],
  );

  const getJumpHint = useCallback(
    (clientID: string) => {
      const peer = doc
        ?.getOthersPresences()
        .find((p) => p.clientID === clientID);
      if (!peer?.presence?.activeCursorPos) return undefined;
      const username = peer.presence.username;
      if (typeof username !== "string" || !username) return "cursor";
      return username;
    },
    [doc],
  );

  // Track edit context changes from the editor
  useEffect(() => {
    if (!editor) return;
    editor.onEditContextChange(setEditContext);
  }, [editor]);

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
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  className="h-7 w-7 min-w-7 p-0"
                  aria-label={
                    commentsPanelOpen ? "Hide comments" : "Show comments"
                  }
                  pressed={commentsPanelOpen}
                  onPressedChange={setCommentsPanelOpen}
                >
                  <IconMessage size={16} />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                {commentsPanelOpen ? "Hide comments" : "Show comments"}
              </TooltipContent>
            </Tooltip>
            <DocsExportButton
              editor={editor}
              title={documentData?.title ?? "document"}
            />
            <ShareDialog documentId={documentId} />
            <UserPresence
              onSelectPeer={handleSelectPeer}
              getJumpHint={getJumpHint}
            />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <DocsFormattingToolbar
            editor={editor}
            editContext={editContext}
            documentTitle={documentData?.title}
          />
          <DocsView
            onEditorReady={setEditor}
            onJumpHandleReady={setJumpHandle}
            documentId={documentId}
            commentsPanelOpen={commentsPanelOpen}
            onCommentsPanelOpenChange={setCommentsPanelOpen}
          />
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
        username: currentUser.username,
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
