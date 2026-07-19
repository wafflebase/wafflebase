import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { isAuthExpiredError } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";

/**
 * Shared app shell for the `/f/:id` file routes (pdf + image). Owns the
 * sidebar, the editable title header, workspace nav, and the not-found
 * redirect. The Yorkie provider (if any) is supplied by the caller wrapping
 * this shell — image documents have none.
 */
export function FileShell({
  documentId,
  headerActions,
  children,
}: {
  documentId: string;
  headerActions: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: documentData, isError: isDocumentError } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
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
    const base = workspaceSlug
      ? {
          docs: `/w/${workspaceSlug}`,
          data: `/w/${workspaceSlug}/datasources`,
          settings: `/w/${workspaceSlug}/settings`,
        }
      : { docs: "/documents", data: "/datasources", settings: "/settings" };
    return {
      main: [
        { title: "Documents", url: base.docs, icon: IconFolder },
        { title: "Data Sources", url: base.data, icon: IconDatabase },
        { title: "Settings", url: base.settings, icon: IconSettings },
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
      try {
        await renameDocument(documentId, newTitle);
        queryClient.invalidateQueries({ queryKey: ["document", documentId] });
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } catch (error) {
        if (isAuthExpiredError(error)) return;
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
        >
          <div className="flex items-center gap-2">{headerActions}</div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
