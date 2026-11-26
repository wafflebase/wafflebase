import { ReactElement, useCallback } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional, isBackendUnreachableError } from "./api/auth";
import { OfflineScreen } from "./components/offline-screen";

/**
 * Redirects authenticated users away from public-only routes.
 */
export const PublicRoute = (): ReactElement => {
  const { data: me, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["me", "optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });
  const retry = useCallback(() => void refetch(), [refetch]);

  if (isLoading) {
    return <Loader />;
  }

  // No response at all is not "signed out": say so, and keep the URL, so
  // the same route opens once the server answers again.
  if (isBackendUnreachableError(error)) {
    return <OfflineScreen onRetry={retry} retrying={isFetching} />;
  }

  // `replace` for the same reason `PrivateRoute`'s redirect is one: the app is
  // correcting the URL on its own behalf, and `NavigationGuardProvider` holds
  // back pushes only.
  return me ? <Navigate to="/" replace /> : <Outlet />;
};
