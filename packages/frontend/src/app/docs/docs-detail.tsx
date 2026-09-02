import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
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
import { IconMessage, IconHistory } from "@tabler/icons-react";
import { useWorkspaceNavItems } from "@/hooks/use-workspace-nav-items";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { initialDocsRoot, type YorkieDocsRoot } from "@/types/docs-document";
import type { DocsPresence } from "@/types/users";
import type { EditContext } from "@wafflebase/docs";
import { DocsView, type EditorAPI, type JumpHandle } from "./docs-view";
import { DocsExportButton } from "./docs-export-button";
import { DocsFormattingToolbar } from "./docs-formatting-toolbar";
import { LazyHistoryPanel as HistoryPanel } from "@/components/history/history-panel-lazy";
import { isHistoryEnabled } from "@/components/history/history-enabled";


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

  const [historyOpen, setHistoryOpen] = useState(false);
  // No `previewRevisionId` state here, unlike the other four editors:
  // docs snapshots can't be parsed (`YSON.parse` can't read past three
  // `Tree(...)` brace levels; every docs document nests `doc > block >
  // inline > text`, depth 4 — see `snapshot-adapters.ts`), so `HistoryPanel`
  // is mounted with no `onPreview` and renders its Preview button disabled
  // with a reason instead of a dead click.
  // Bumped on restore to remount DocsView, dropping its local selection and
  // caret state. `doc.clearHistory()` (below) separately drops the Yorkie
  // undo stack — a restore replaces the whole root, so neither piece of
  // state describes a document that still exists.
  const [historyResetToken, setHistoryResetToken] = useState(0);
  const handleHistoryRestored = useCallback(() => {
    try {
      doc?.clearHistory();
    } catch {
      // Best-effort: the document may already be detached.
    }
    setHistoryResetToken((t) => t + 1);
  }, [doc]);

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

  // Re-reads the same cached ["me"] entry DocsDetail already populated
  // (react-query dedupes on the key), matching the pattern DocsView uses for
  // the same purpose rather than threading the id down as a prop.
  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
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

  const items = useWorkspaceNavItems(workspaceSlug);

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

  // This route is only ever reached by an authenticated workspace member
  // (mounted behind PrivateRoute) — a share-link viewer or editor opens the
  // document through /shared/:token instead, which never mounts this
  // component. The role is therefore always "member" here.
  const historyEnabled = isHistoryEnabled(import.meta.env, "member");

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
          syncStatus
          onRename={handleRenameDocument}
        >
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  className="h-8 w-8 min-w-8 cursor-pointer border p-0"
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
            {historyEnabled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Toggle
                    size="sm"
                    className="h-8 w-8 min-w-8 cursor-pointer border p-0"
                    aria-label={
                      historyOpen ? "Hide version history" : "Show version history"
                    }
                    pressed={historyOpen}
                    onPressedChange={setHistoryOpen}
                  >
                    <IconHistory size={16} />
                  </Toggle>
                </TooltipTrigger>
                <TooltipContent>
                  {historyOpen ? "Hide version history" : "Show version history"}
                </TooltipContent>
              </Tooltip>
            )}
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
          <DocsFormattingToolbar editor={editor} editContext={editContext} />
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <DocsView
              key={historyResetToken}
              onEditorReady={setEditor}
              onJumpHandleReady={setJumpHandle}
              documentId={documentId}
              workspaceId={documentData?.workspaceId}
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
            {historyEnabled && historyOpen && currentUser && (
              <HistoryPanel
                userId={currentUser.id}
                onClose={() => setHistoryOpen(false)}
                onRestored={handleHistoryRestored}
              />
            )}
          </div>
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
