import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { Loader } from "@/components/loader";
import { initialBoardRoot } from "@/types/board-document";
import { BoardView } from "./board-view";

/**
 * BoardDetail wraps the board editor with a Yorkie DocumentProvider,
 * handling authentication and providing the collaborative document context.
 */
export function BoardDetail() {
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
      docKey={`board-${id}`}
      initialRoot={initialBoardRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
        selectedElementIds: [],
        cursor: null,
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <BoardView documentId={id!} />
    </DocumentProvider>
  );
}

export default BoardDetail;
