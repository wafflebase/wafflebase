import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchWorkspace } from "@/api/workspaces";

import type { MentionMember } from "./components/CommentComposer";

/**
 * Workspace members for the comment `@` mention autocomplete, sourced from
 * the existing `GET /workspaces/:id` response (no dedicated endpoint). The
 * userId is stringified to match `CommentAuthor.userId`.
 *
 * Returns an empty list when no workspace is in scope (e.g. anonymous
 * share-link viewers), which disables the mention dropdown while existing
 * mention chips still render fine.
 */
export function useWorkspaceMembers(
  workspaceId: string | undefined,
): MentionMember[] {
  // Same key/fetcher as the rest of the app's workspace-detail query, so the
  // member list shares one cache entry instead of issuing a duplicate fetch.
  const { data } = useQuery({
    queryKey: ["workspaces", workspaceId],
    queryFn: () => fetchWorkspace(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(
    () =>
      (data?.members ?? []).map((m) => ({
        userId: String(m.user.id),
        username: m.user.username,
        photo: m.user.photo || undefined,
      })),
    [data],
  );
}
