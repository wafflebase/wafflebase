import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { Loader } from "@/components/loader";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { DocsView } from "./docs-view";

/**
 * Initial Yorkie document root for a new docs document.
 * Creates a Tree with a single empty paragraph block.
 */
function initialDocsRoot(): YorkieDocsRoot {
  return {
    content: {
      type: "doc",
      children: [
        {
          type: "block",
          attributes: {
            id: `block-${Date.now()}-0`,
            type: "paragraph",
            alignment: "left",
            lineHeight: "1.5",
            marginTop: "0",
            marginBottom: "8",
            textIndent: "0",
            marginLeft: "0",
          },
          children: [
            {
              type: "inline",
              children: [{ type: "text", value: "" }],
            },
          ],
        },
      ],
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Yorkie converts the plain object to a Tree
  };
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
    <DocumentProvider<YorkieDocsRoot>
      docKey={`docs-${id}`}
      initialRoot={initialDocsRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <DocsView />
    </DocumentProvider>
  );
}

export default DocsDetail;
