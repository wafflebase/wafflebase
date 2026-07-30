import { Navigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { fetchMe } from "@/api/auth";
import { fetchDocument } from "@/api/documents";
import { downloadDocumentFile } from "@/api/download-file";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/loader";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import type { User } from "@/types/users";
import { FileShell } from "./file-shell";
import { ImageViewer } from "./image-viewer";
import {
  PdfCollabProvider,
  PdfHeaderActions,
  PdfCollabBody,
} from "./pdf-collab";

/** Header icon button that saves a blob-backed document to disk. */
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
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await downloadDocumentFile({ id: documentId, title, fileId });
        } catch {
          toast.error("Failed to download");
        }
      }}
    >
      <Download className="h-4 w-4" />
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
  return (
    <PdfCollabProvider
      documentId={documentId}
      readOnly={false}
      presenceUser={{
        userId: String(currentUser.id),
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo,
      }}
    >
      <FileShell
        documentId={documentId}
        headerActions={
          <>
            <PdfHeaderActions />
            <DownloadFileButton
              documentId={documentId}
              title={title}
              fileId={fileId}
              label="Download PDF"
            />
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </>
        }
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
}: {
  documentId: string;
  title: string;
  fileId?: string;
}) {
  return (
    <FileShell
      documentId={documentId}
      headerActions={
        <>
          <DownloadFileButton
            documentId={documentId}
            title={title}
            fileId={fileId}
            label="Download image"
          />
          <ShareDialog documentId={documentId} />
        </>
      }
    >
      <ImageViewer documentId={documentId} />
    </FileShell>
  );
}

/**
 * FileDetail is the `/f/:id` route shared by static blob documents. It
 * auth-gates on the current user, resolves the document `type`, then mounts
 * the matching layout: pdf → collaborative PDF (comments + presence over the
 * `pdf-<id>` Yorkie doc); image → a plain viewer with no Yorkie attachment.
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
