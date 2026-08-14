import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { initialNotesRoot, noteUserColor } from "@/types/notes-document";
import { uploadImageFile } from "@/app/spreadsheet/image-upload";
import { NotesView } from "./notes-view";
import { NotesToolbar } from "./notes-toolbar";

/**
 * NotesLayout provides the sidebar + header chrome around the note editor,
 * matching the same layout structure as the docs/spreadsheet detail views.
 */
function NotesLayout({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<NoteEditorAPI | null>(null);
  // View mode + keyboard mode are per-user (localStorage) preferences, not
  // per-document — they persist across notes and reloads.
  const [viewMode, setViewMode] = useState<NoteViewMode>(readViewMode);
  const [keymap, setKeymap] = useState<NoteKeymap>(readKeymap);

  const handleViewModeChange = useCallback((next: NoteViewMode) => {
    setViewMode(next);
    writeViewMode(next);
  }, []);

  const handleKeymapChange = useCallback((next: NoteKeymap) => {
    setKeymap(next);
    writeKeymap(next);
  }, []);

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
    if (workspaceSlug) {
      return {
        main: [
          { title: "Documents", url: `/w/${workspaceSlug}`, icon: IconFolder },
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
          <NotesToolbar
            mode={viewMode}
            onModeChange={handleViewModeChange}
            keymap={keymap}
            onKeymapChange={handleKeymapChange}
            editor={editor}
          />
          <NotesView
            viewMode={viewMode}
            keymap={keymap}
            onEditorReady={setEditor}
            uploadImage={handleUploadImage}
          />
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
