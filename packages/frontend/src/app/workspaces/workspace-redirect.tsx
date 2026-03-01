import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces } from "@/api/workspaces";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Redirects to the first available workspace on the root path.
 */
export function WorkspaceRedirect() {
  const navigate = useNavigate();
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  useEffect(() => {
    if (workspaces && workspaces.length > 0) {
      navigate(`/w/${workspaces[0].slug}`, { replace: true });
    }
  }, [workspaces, navigate]);

  return (
    <div className="flex items-center justify-center h-64">
      <Skeleton className="h-5 w-32" />
    </div>
  );
}
