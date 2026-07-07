import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { fetchMe } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { toast } from "sonner";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { pdfFileUrl } from "@/api/files";
import { PdfViewer } from "./pdf-viewer";

function FileLayout({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const handleRenameDocument = useCallback(
    async (newTitle: string) => {
      try {
        await renameDocument(documentId, newTitle);
        queryClient.invalidateQueries({ queryKey: ["document", documentId] });
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } catch {
        toast.error("Failed to rename document");
      }
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
        />
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <PdfViewer fileUrl={pdfFileUrl(documentId)} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * FileDetail is the read-only PDF viewer route. Auth-gates on the current
 * user, then mounts the app shell + pdf.js viewer. No Yorkie/CRDT — the PDF
 * is static content served (permission-gated) from the blob store.
 */
export function FileDetail() {
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

  return <FileLayout documentId={id!} />;
}

export default FileDetail;
