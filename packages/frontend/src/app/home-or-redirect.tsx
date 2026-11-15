import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "@/api/auth";
import { fetchWorkspaces } from "@/api/workspaces";
import { Suspense, useEffect } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { Navigate } from "react-router-dom";
import { Loader } from "@/components/loader";

const loadHomePage = () => import("@/app/home/page");
const HomePage = lazyWithRetry(loadHomePage);

export function HomeOrRedirect() {
  // Start the homepage chunk alongside the session check rather than after
  // it, so a signed-out visitor waits for one round trip, not two. A
  // signed-in visitor is redirected and pays only for a small unused chunk.
  useEffect(() => {
    void loadHomePage().catch(() => {});
  }, []);

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

  if (user && workspaces && workspaces.length > 0) {
    return <Navigate to={`/w/${workspaces[0].slug}`} replace />;
  }

  return (
    <Suspense fallback={<Loader />}>
      <HomePage workspacePath={null} />
    </Suspense>
  );
}
