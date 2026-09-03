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
 */
export function useDocumentsPath(
  workspaceId?: string,
  folderId?: string | null,
): string {
  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const own = workspaces.find((w) => w.id === workspaceId);
  const slug = own?.slug ?? workspaces[0]?.slug;
  if (!slug) return "/documents";
  // A folder id only means something inside its own workspace's tree, so it
  // is dropped when this fell back to some other workspace — that list would
  // otherwise filter on a folder it does not contain and come up empty.
  return own && folderId
    ? `/w/${slug}?folder=${encodeURIComponent(folderId)}`
    : `/w/${slug}`;
}
