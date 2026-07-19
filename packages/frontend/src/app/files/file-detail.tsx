import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { fetchDocument } from "@/api/documents";
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

function PdfFileLayout({
  documentId,
  currentUser,
}: {
  documentId: string;
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

function ImageFileLayout({ documentId }: { documentId: string }) {
  return (
    <FileShell
      documentId={documentId}
      headerActions={<ShareDialog documentId={documentId} />}
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

  const { data: documentData, isLoading: docLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    retry: false,
    enabled: !!id,
  });

  if (userLoading || docLoading) return <Loader />;
  if (userError || !currentUser) return <Navigate to="/login" replace />;

  if (documentData?.type === "image") {
    return <ImageFileLayout documentId={id!} />;
  }
  return <PdfFileLayout documentId={id!} currentUser={currentUser} />;
}

export default FileDetail;
