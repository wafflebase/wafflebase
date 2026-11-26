import { useCallback } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { fetchMe } from "@/api/auth";
import { fetchDocument } from "@/api/documents";
import { downloadDocumentFile } from "@/api/download-file";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useHeaderPlacement } from "@/components/header-placement";
import { Loader } from "@/components/loader";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import type { User } from "@/types/users";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRightPanels } from "@/components/use-right-panels";
import { FileShell } from "./file-shell";
import { GenericFileView } from "./generic-file-view";
import { ImageViewer } from "./image-viewer";
import { useDocumentsPath } from "./use-documents-path";
import {
  PdfCollabProvider,
  PdfHeaderActions,
  PdfCollabBody,
} from "./pdf-collab";

/**
 * Header icon button that saves a blob-backed document to disk. It fills
 * the header's `export` slot, which a phone moves into the More menu, where
 * it is a menu row instead.
 */
function DownloadFileButton({
  documentId,
  title,
  fileId,
  label,
}: {
  documentId: string;
  title: string;
  fileId?: string;
  label: string;
}) {
  const download = async () => {
    try {
      await downloadDocumentFile({ id: documentId, title, fileId });
    } catch {
      toast.error("Couldn't download the file");
    }
  };
  if (useHeaderPlacement() === "menu") {
    // Inset so the row lines up with the checked panel rows above it.
    return (
      <DropdownMenuItem
        className="cursor-pointer"
        inset
        onSelect={() => void download()}
      >
        <Download className="h-4 w-4" />
        {label}
      </DropdownMenuItem>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => void download()}
    >
      <Download className="h-4 w-4" />
    </Button>
  );
}

/** Header button that leaves a viewer for the documents list. */
function BackToDocumentsButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  /** True while the destination is still unknown (workspace list loading). */
  disabled?: boolean;
}) {
  const label = "Back to documents";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className="shrink-0"
      disabled={disabled}
      onClick={onClick}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}

function PdfFileLayout({
  documentId,
  title,
  fileId,
  currentUser,
}: {
  documentId: string;
  title: string;
  fileId?: string;
  currentUser: User;
}) {
  // The viewer's comments and the shell's chat share the right-hand slot.
  const panels = useRightPanels(useIsMobile());
  return (
    <PdfCollabProvider
      documentId={documentId}
      readOnly={false}
      panel={[panels.commentsOpen, panels.setCommentsOpen]}
      presenceUser={{
        userId: String(currentUser.id),
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo,
      }}
    >
      <FileShell
        documentId={documentId}
        panels={panels}
        headerActions={{
          comments: <PdfHeaderActions />,
          export: (
            <DownloadFileButton
              documentId={documentId}
              title={title}
              fileId={fileId}
              label="Download PDF"
            />
          ),
          share: <ShareDialog documentId={documentId} />,
          presence: <UserPresence />,
        }}
      >
        <PdfCollabBody />
      </FileShell>
    </PdfCollabProvider>
  );
}

function ImageFileLayout({
  documentId,
  title,
  fileId,
  workspaceId,
  folderId,
}: {
  documentId: string;
  title: string;
  fileId?: string;
  workspaceId?: string;
  folderId?: string | null;
}) {
  const navigate = useNavigate();
  const documentsPath = useDocumentsPath(workspaceId, folderId);
  // Shared by the header button and the viewer's Esc key, so both leave for
  // the same list. Both stay inert until the destination is known — leaving
  // for the wrong list is worse than not leaving yet.
  const close = useCallback(() => {
    if (documentsPath) navigate(documentsPath);
  }, [navigate, documentsPath]);

  return (
    <FileShell
      documentId={documentId}
      headerLeading={
        <BackToDocumentsButton onClick={close} disabled={!documentsPath} />
      }
      headerActions={{
        export: (
          <DownloadFileButton
            documentId={documentId}
            title={title}
            fileId={fileId}
            label="Download image"
          />
        ),
        share: <ShareDialog documentId={documentId} />,
      }}
    >
      <ImageViewer documentId={documentId} onClose={close} />
    </FileShell>
  );
}

function GenericFileLayout({
  documentId,
  title,
  fileId,
  fileSize,
  createdAt,
}: {
  documentId: string;
  title: string;
  fileId?: string;
  fileSize?: number;
  createdAt?: string;
}) {
  return (
    <FileShell
      documentId={documentId}
      headerActions={{
        export: (
          <DownloadFileButton
            documentId={documentId}
            title={title}
            fileId={fileId}
            label="Download file"
          />
        ),
        share: <ShareDialog documentId={documentId} />,
      }}
    >
      <GenericFileView
        title={title}
        fileId={fileId}
        fileSize={fileSize}
        createdAt={createdAt}
      />
    </FileShell>
  );
}

/**
 * FileDetail is the `/f/:id` route shared by static blob documents. It
 * auth-gates on the current user, resolves the document `type`, then mounts
 * the matching layout: pdf → collaborative PDF (comments + presence over the
 * `pdf-<id>` Yorkie doc); image → a plain viewer with no Yorkie attachment;
 * file → a static card (icon, name, size, download) with no Yorkie attachment.
 */
export function FileDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading: userLoading,
    isError: userError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: documentData,
    isLoading: docLoading,
    isError: docError,
  } = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    retry: false,
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  if (userLoading || docLoading) return <Loader />;
  if (userError || !currentUser) return <Navigate to="/login" replace />;

  // A failed document fetch must not fall through to the PDF layout, which
  // would attach a pdf-<id> Yorkie doc for what may be an image document.
  // Redirect before any layout (and its Yorkie provider) mounts.
  if (docError || !documentData) return <Navigate to="/documents" replace />;

  if (documentData.type === "image") {
    return (
      <ImageFileLayout
        documentId={id!}
        title={documentData.title}
        fileId={documentData.fileId}
        workspaceId={documentData.workspaceId}
        folderId={documentData.folderId}
      />
    );
  }
  if (documentData.type === "file") {
    return (
      <GenericFileLayout
        documentId={id!}
        title={documentData.title}
        fileId={documentData.fileId}
        fileSize={documentData.fileSize}
        createdAt={documentData.createdAt}
      />
    );
  }
  return (
    <PdfFileLayout
      documentId={id!}
      title={documentData.title}
      fileId={documentData.fileId}
      currentUser={currentUser}
    />
  );
}

export default FileDetail;
