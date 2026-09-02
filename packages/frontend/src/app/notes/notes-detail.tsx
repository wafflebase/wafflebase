import { DocumentProvider, useDocument } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type {
  NoteViewMode,
  NoteEditorAPI,
  NoteKeymap,
} from "@wafflebase/notes";
import {
  readViewMode,
  writeViewMode,
  readKeymap,
  writeKeymap,
  readShowAuthors,
  writeShowAuthors,
} from "./notes-settings";
import { fetchMe, isAuthExpiredError } from "@/api/auth";
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
  initialNotesRoot,
  noteUserColor,
  type YorkieNotesRoot,
  type NotesPresence,
} from "@/types/notes-document";
import { uploadImageFile } from "@/app/spreadsheet/image-upload";
import { NotesView } from "./notes-view";
import { NotesToolbar } from "./notes-toolbar";
import { useIsMobile } from "@/hooks/use-mobile";
import { HistoryPanel } from "@/components/history/history-panel";
import { isHistoryEnabled } from "@/components/history/history-enabled";

/**
 * NotesLayout provides the sidebar + header chrome around the note editor,
 * matching the same layout structure as the docs/spreadsheet detail views.
 */
function NotesLayout({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { doc } = useDocument<YorkieNotesRoot, NotesPresence>();
  const [editor, setEditor] = useState<NoteEditorAPI | null>(null);
  // View mode + keyboard mode are per-user (localStorage) preferences, not
  // per-document — they persist across notes and reloads.
  const [viewMode, setViewMode] = useState<NoteViewMode>(readViewMode);
  const [keymap, setKeymap] = useState<NoteKeymap>(readKeymap);
  // The blame gutter is opt-in and, like the other two, a per-user preference.
  const [showAuthors, setShowAuthors] = useState<boolean>(readShowAuthors);
  const isMobile = useIsMobile();

  const [historyOpen, setHistoryOpen] = useState(false);
  // Held for Task 11's preview surface; nothing reads it yet.
  const [, setPreviewRevisionId] = useState<string | null>(null);
  // Bumped on restore to remount NotesView, dropping its local selection and
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

  // Split is a fixed 50/50 pane layout (`packages/notes` `editor.ts`), so on a
  // 375px phone it is two ~187px panes. The toolbar stops offering it below
  // the mobile breakpoint; this demotes a *stored* `both` — set on a desktop,
  // where the preference is per-user rather than per-document — so a phone
  // never opens into a layout its view menu cannot leave. Render-only: the
  // demotion is never written back through `writeViewMode`, so the stored
  // desktop preference survives untouched and a wider window gets split again.
  const effectiveViewMode: NoteViewMode =
    isMobile && viewMode === "both" ? "edit" : viewMode;

  const handleShowAuthorsChange = useCallback((next: boolean) => {
    setShowAuthors(next);
    writeShowAuthors(next);
  }, []);

  const handleViewModeChange = useCallback(
    (next: NoteViewMode) => {
      setViewMode(next);
      // A mode picked on a phone is session-local. Persisting it would
      // overwrite a stored `both` that the phone was never able to offer in
      // the first place — Split is filtered out of the menu down here — so
      // "let me check the preview on my phone" would silently cost the user
      // their desktop Split preference. Without this the render-only demotion
      // above is only true until the user touches the view menu once.
      if (!isMobile) writeViewMode(next);
    },
    [isMobile],
  );

  const handleKeymapChange = useCallback((next: NoteKeymap) => {
    setKeymap(next);
    writeKeymap(next);
  }, []);

  const { data: documentData, isError: isDocumentError } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  // Re-reads the same cached ["me"] entry NotesDetail already populated
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

  const workspaceId = documentData?.workspaceId;

  /**
   * Upload a pasted / dropped / picked image into the workspace image bucket
   * and hand the editor back an absolute URL to write into the markdown.
   *
   * Returns `null` on every failure — `uploadImageFile` throws for an
   * unsupported type, an oversized file, and a failed request alike, and the
   * user is told here via a toast. The engine treats `null` as "the host
   * already reported this" and quietly drops its upload placeholder.
   */
  const handleUploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!workspaceId) {
        toast.error("Still loading this note's workspace — try again.");
        return null;
      }
      try {
        const { url } = await uploadImageFile(file, workspaceId);
        return url;
      } catch (err) {
        // An expired session is already redirecting to login; a failure toast
        // on the way out is noise, not information.
        if (isAuthExpiredError(err)) return null;
        console.error("Note image upload failed", err);
        toast.error(
          err instanceof Error
            ? `Image upload failed: ${err.message}`
            : "Image upload failed",
        );
        return null;
      }
    },
    [workspaceId],
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
  // note through /shared/:token instead, which never mounts this component.
  // The role is therefore always "member" here.
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
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <NotesToolbar
            mode={effectiveViewMode}
            onModeChange={handleViewModeChange}
            keymap={keymap}
            onKeymapChange={handleKeymapChange}
            showAuthors={showAuthors}
            onShowAuthorsChange={handleShowAuthorsChange}
            editor={editor}
          />
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <NotesView
              key={historyResetToken}
              viewMode={effectiveViewMode}
              keymap={keymap}
              showAuthors={showAuthors}
              onEditorReady={setEditor}
              uploadImage={handleUploadImage}
              documentId={documentId}
            />
            {historyEnabled && historyOpen && currentUser && (
              <HistoryPanel
                userId={currentUser.id}
                onClose={() => setHistoryOpen(false)}
                onPreview={setPreviewRevisionId}
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
 * NotesDetail wraps the note editor with a Yorkie DocumentProvider,
 * handling authentication and providing the collaborative document context.
 */
export function NotesDetail() {
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
      docKey={`note-${id}`}
      initialRoot={initialNotesRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
        color: noteUserColor(currentUser.username),
        name: currentUser.username,
        selection: null,
        cursor: null,
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <NotesLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default NotesDetail;
