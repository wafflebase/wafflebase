import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "@/api/auth";
import { fetchWorkspaces } from "@/api/workspaces";
import { Loader } from "@/components/loader";
import { lazy, Suspense } from "react";

const HomePage = lazy(() => import("@/app/home/page"));

export function HomeOrRedirect() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: !!user,
  });

  if (userLoading) return <Loader />;

  if (user && workspaces && workspaces.length > 0) {
    return <Navigate to={`/w/${workspaces[0].slug}`} replace />;
  }

  if (user) return <Loader />;

  return (
    <Suspense fallback={<Loader />}>
      <HomePage />
    </Suspense>
  );
}
