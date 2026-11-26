import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, type ReactNode } from "react";
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
import { SiteHeader, type HeaderActions } from "@/components/site-header";
import { useWorkspaceNavItems } from "@/hooks/use-workspace-nav-items";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRightPanels, type RightPanels } from "@/components/use-right-panels";
import { ChatPanelProvider } from "@/components/chat/chat-panel-provider";
import {
  ChatPanelToggle,
  LazyChatPanel,
} from "@/components/chat/chat-panel-slot";
import { useDocumentsPath } from "./use-documents-path";

/**
 * Shared app shell for the `/f/:id` file routes (pdf + image). Owns the
 * sidebar, the editable title header, workspace nav, and the not-found
 * redirect. The Yorkie provider (if any) is supplied by the caller wrapping
 * this shell — image documents have none.
 *
 * It also hosts the chat panel, in the right-hand slot beside `children`,
 * and puts its toggle in the header's `chat` slot itself. The header is
 * slotted like every editor's, so on a phone the panel toggles and the
 * download move into the More menu the same way — each viewer's controls
 * read `useHeaderPlacement()` for that.
 */
export function FileShell({
  documentId,
  headerActions,
  headerLeading,
  panels: hostPanels,
  children,
}: {
  documentId: string;
  /** The viewer's header controls, by slot; `chat` is the shell's own. */
  headerActions: Omit<HeaderActions, "chat">;
  /** Optional header control rendered left of the title. */
  headerLeading?: ReactNode;
  /**
   * The right-hand slot's state, when the caller also draws a panel there
   * (the PDF viewer's comments) and so has to share it. Kept here otherwise.
   */
  panels?: RightPanels;
  children: ReactNode;
}) {
  const ownPanels = useRightPanels(useIsMobile());
  const { chatOpen, setChatOpen } = hostPanels ?? ownPanels;
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
  const documentsPath = useDocumentsPath(
    documentData?.workspaceId,
    documentData?.folderId,
  );

  useEffect(() => {
    // `documentsPath` is null until the workspace list arrives; redirecting
    // before then would land on the cross-workspace list rather than the one
    // this document belongs to. The effect re-runs when it settles.
    if (isDocumentError && documentsPath) {
      toast.error("Document not found");
      navigate(documentsPath, { replace: true });
    }
  }, [isDocumentError, navigate, documentsPath]);

  const items = useWorkspaceNavItems(workspaceSlug);

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
        toast.error("Couldn't rename the document");
      }
    },
    [documentId, queryClient],
  );

  return (
    <ChatPanelProvider open={chatOpen} onOpenChange={setChatOpen}>
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
          title={documentData?.title ?? "Loading…"}
          editable
          onRename={handleRenameDocument}
          leading={headerLeading}
          actions={{ ...headerActions, chat: <ChatPanelToggle /> }}
        />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col min-h-0 overflow-hidden">
            {children}
          </div>
          {chatOpen && documentData && (
            <LazyChatPanel
              workspaceId={documentData.workspaceId}
              documentId={documentId}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
    </ChatPanelProvider>
  );
}
