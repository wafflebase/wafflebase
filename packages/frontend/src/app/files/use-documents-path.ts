import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";

/**
 * Resolves the documents list a `/f/:id` file route should return to: the
 * list of the document's own workspace when that workspace is known, else
 * the first workspace the user has, else the workspace-less list. When the
 * document lives in a folder, the destination is that folder's list rather
 * than the workspace root — `/w/:slug` carries the folder as a `?folder`
 * query parameter (see `workspace-documents.tsx`), not as a path segment,
 * so a path built without it always reads as the root.
 *
 * Lives in a hook because two siblings need the same destination — the
 * header's back button and the viewer's Esc key. The `["workspaces"]` query
 * is shared with `FileShell` by react-query, so this costs no extra request.
 *
 * Returns `null` while that query is still pending. An empty workspace list
 * is otherwise indistinguishable from one that has not arrived yet, and both
 * would resolve to `/documents` — so a user who opens `/f/:id` directly and
 * hits Back within the first moments would be sent to the cross-workspace
 * list, losing exactly the workspace and folder this hook exists to keep.
 * Callers hold the control inert until it settles.
 */
export function useDocumentsPath(
  workspaceId?: string,
  folderId?: string | null,
): string | null {
  const { data: workspaces, isPending } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  if (isPending) return null;

  const ownWorkspace = workspaces?.find((w) => w.id === workspaceId);
  if (ownWorkspace) {
    return folderId
      ? `/w/${ownWorkspace.slug}?folder=${encodeURIComponent(folderId)}`
      : `/w/${ownWorkspace.slug}`;
  }

  // A folder id only means something inside its own workspace's tree, so the
  // fallback never carries one — that list would filter on a folder it does
  // not contain and come up empty.
  const fallback = workspaces?.[0]?.slug;
  return fallback ? `/w/${fallback}` : "/documents";
}
