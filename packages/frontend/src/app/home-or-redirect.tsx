import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "@/api/auth";
import { fetchWorkspaces } from "@/api/workspaces";
import { lazy, Suspense } from "react";
import { Loader } from "@/components/loader";

const HomePage = lazy(() => import("@/app/home/page"));

export function HomeOrRedirect() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  const { data: workspaces, isLoading: workspacesLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: !!user,
  });

  if (userLoading || (user && workspacesLoading)) return <Loader />;

  const workspacePath =
    user && workspaces && workspaces.length > 0
      ? `/w/${workspaces[0].slug}`
      : null;

  return (
    <Suspense fallback={<Loader />}>
      <HomePage workspacePath={workspacePath} />
    </Suspense>
  );
}
