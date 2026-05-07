import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { Loader } from "@/components/loader";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import { SlidesView } from "./slides-view";

/**
 * Initial Yorkie document root for a new slides presentation.
 * The root shape is fully populated lazily by `ensureSlidesRoot` on
 * first mount, so we only seed an empty root here.
 */
function initialSlidesRoot(): Partial<YorkieSlidesRoot> {
  return {};
}

/**
 * SlidesDetail wraps the slides editor with a Yorkie DocumentProvider,
 * mirroring `DocsDetail`: authenticate the user, then keyed-attach the
 * Yorkie document and let `SlidesView` mount the editor.
 *
 * The Phase 4a route is `/p/:id`; the document key follows the same
 * `slides-{id}` namespacing pattern as docs uses (`doc-{id}`) so the
 * three document types (sheet, doc, slides) never collide on Yorkie.
 */
export function SlidesDetail() {
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
      docKey={`slides-${id}`}
      initialRoot={initialSlidesRoot()}
      initialPresence={{
        username: encodeURIComponent(currentUser.username),
        email: currentUser.email,
        photo: currentUser.photo || "",
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <SlidesView documentId={id} />
    </DocumentProvider>
  );
}

export default SlidesDetail;
