import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";

/**
 * Resolves the documents list a `/f/:id` file route should return to: the
 * list of the document's own workspace when that workspace is known, else
 * the first workspace the user has, else the workspace-less list.
 *
 * Lives in a hook because two siblings need the same destination — the
 * header's back button and the viewer's Esc key. The `["workspaces"]` query
 * is shared with `FileShell` by react-query, so this costs no extra request.
 */
export function useDocumentsPath(workspaceId?: string): string {
  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const slug =
    workspaces.find((w) => w.id === workspaceId)?.slug ?? workspaces[0]?.slug;
  return slug ? `/w/${slug}` : "/documents";
}
