import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
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
import { IconHistory } from "@tabler/icons-react";
import { useWorkspaceNavItems } from "@/hooks/use-workspace-nav-items";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import {
  initialBoardRoot,
  type YorkieBoardRoot,
  type BoardPresence,
} from "@/types/board-document";
import { BoardView } from "./board-view";
import { HistoryPanel } from "@/components/history/history-panel";
import { isHistoryEnabled } from "@/components/history/history-enabled";

// Lazy: `revision-preview.tsx` statically imports all three of
// @wafflebase/sheets, @wafflebase/slides and @wafflebase/notes (it mounts
// whichever engine a preview needs), so an eager import here would pull the
// other two engines into this board route's own chunk for a feature almost
// never opened.
const RevisionPreviewOverlay = lazy(() =>
  import("@/components/history/revision-preview").then((module) => ({
    default: module.RevisionPreviewOverlay,
  })),
);

/**
 * BoardLayout provides the global sidebar + top header chrome around the
 * board canvas, matching the docs/slides/notes detail views. `SidebarInset`
 * gives the canvas its full-height flex parent (so BoardView's `h-full`
 * host sizes correctly). The insert toolbar lives inside BoardView, below
 * this header — analogous to where NotesToolbar sits under the header.
 */
function BoardLayout({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { doc } = useDocument<YorkieBoardRoot, BoardPresence>();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewRevisionId, setPreviewRevisionId] = useState<string | null>(null);
  // Bumped on restore to remount BoardView, dropping its local selection
  // state. `doc.clearHistory()` (below) separately drops the Yorkie undo
  // stack — a restore replaces the whole root, so neither piece of state
  // describes a document that still exists.
  const [historyResetToken, setHistoryResetToken] = useState(0);
  const handleHistoryRestored = useCallback(() => {
    try {
      doc?.clearHistory();
    } catch {
      // Best-effort: the document may already be detached.
    }
    setHistoryResetToken((t) => t + 1);
  }, [doc]);

  const { data: documentData, isError: isDocumentError } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  // Re-reads the same cached ["me"] entry BoardDetail already populated
  // (react-query dedupes on the key) — needed for the history panel's
  // userId, which is not otherwise threaded down to this layout.
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
  // board through /shared/:token instead, which never mounts this
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
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="relative flex flex-1 min-w-0">
            {historyEnabled && previewRevisionId && currentUser && (
              <Suspense fallback={null}>
                <RevisionPreviewOverlay
                  revisionId={previewRevisionId}
                  type="board"
                  userId={currentUser.id}
                  onClose={() => setPreviewRevisionId(null)}
                  onRestored={handleHistoryRestored}
                />
              </Suspense>
            )}
            <BoardView
              key={historyResetToken}
              documentId={documentId}
              workspaceId={documentData?.workspaceId}
            />
          </div>
          {historyEnabled && historyOpen && currentUser && (
            <HistoryPanel
              userId={currentUser.id}
              onClose={() => setHistoryOpen(false)}
              onPreview={setPreviewRevisionId}
              onRestored={handleHistoryRestored}
              refreshKey={historyResetToken}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * BoardDetail wraps the board canvas with a Yorkie DocumentProvider,
 * handling authentication and providing the collaborative document context.
 */
export function BoardDetail() {
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
      docKey={`board-${id}`}
      initialRoot={initialBoardRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
        selectedElementIds: [],
        cursor: null,
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <BoardLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default BoardDetail;
