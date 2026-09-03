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
import {
  EditingChrome,
  PreviewSurface,
} from "@/components/history/preview-surface";

// Lazy for the same reason as the other four editors: `revision-preview.tsx`
// statically imports every engine it might have to mount (sheets, slides,
// notes and docs), so an eager import here would pull the other three into
// this route's chunk for a feature almost never opened.
const RevisionPreviewOverlay = lazy(() =>
  import("@/components/history/revision-preview").then((module) => ({
    default: module.RevisionPreviewOverlay,
  })),
);


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
  const [previewRevisionId, setPreviewRevisionId] = useState<string | null>(
    null,
  );
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

  // The single source of truth for "a preview is covering the editor pane",
  // read by both halves of the containment: `EditingChrome` (which removes
  // the toolbar) and `PreviewSurface` (which covers the pane). One
  // expression so the two can never disagree.
  const previewing = Boolean(previewRevisionId && currentUser);

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
            {/* The comments toggle is editing chrome, so a preview removes it
                like the formatting toolbar — otherwise it is the one control
                that could re-open the side panel *over* an open preview. */}
            <EditingChrome previewing={previewing}>
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
            </EditingChrome>
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
          {/* Same arrangement as slides and notes, for the same reason: the
              formatting toolbar stays full-width above the panel row, and a
              preview contains it by REMOVING it. Leaving it live under a
              banner would let a viewer restyle the document they believe
              they are only looking at. See `EditingChrome`. */}
          <EditingChrome previewing={previewing}>
            <DocsFormattingToolbar editor={editor} editContext={editContext} />
          </EditingChrome>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <PreviewSurface
              preview={
                previewing && previewRevisionId && currentUser ? (
                  <Suspense fallback={null}>
                    <RevisionPreviewOverlay
                      revisionId={previewRevisionId}
                      type="doc"
                      userId={currentUser.id}
                      onClose={() => setPreviewRevisionId(null)}
                      onRestored={handleHistoryRestored}
                    />
                  </Suspense>
                ) : null
              }
            >
              <DocsView
                key={historyResetToken}
                onEditorReady={setEditor}
                onJumpHandleReady={setJumpHandle}
                documentId={documentId}
                workspaceId={documentData?.workspaceId}
                // Docs is the only editor with a z-indexed panel *inside*
                // `PreviewSurface`: the comments panel is `z-40` and the
                // preview overlay is `z-20`, and neither `PreviewSurface` nor
                // `DocsView`'s root creates a stacking context (both are
                // `position: relative` with `z-index: auto`). So covering
                // does not contain this one — the panel painted above the
                // preview, fully clickable, and its Resolve / Reply / Edit /
                // Delete controls all mutate the LIVE document behind it.
                // That is exactly the failure `preview-surface.tsx` describes.
                // Withholding it applies that module's own rule instead: while
                // a preview is open, no editing control is both rendered and
                // reachable. The user's choice survives — `commentsPanelOpen`
                // is untouched, so closing the preview restores the panel.
                commentsPanelOpen={commentsPanelOpen && !previewing}
                onCommentsPanelOpenChange={setCommentsPanelOpen}
              />
            </PreviewSurface>
            {historyOpen && currentUser && (
              <HistoryPanel
                userId={currentUser.id}
                onClose={() => setHistoryOpen(false)}
                onPreview={setPreviewRevisionId}
                onRestored={handleHistoryRestored}
                refreshKey={historyResetToken}
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
