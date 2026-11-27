import { ReactElement, useCallback } from "react";
import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional, isBackendUnreachableError } from "./api/auth";
import { OfflineScreen } from "./components/offline-screen";
import { signedInTarget } from "./lib/return-to";

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
  const [searchParams] = useSearchParams();

  if (isLoading) {
    return <Loader />;
  }

  // No response at all is not "signed out": say so, and keep the URL, so
  // the same route opens once the server answers again. Only while no user is
  // known: a failed refetch keeps the last answer, and that still holds.
  if (!me && isBackendUnreachableError(error)) {
    return <OfflineScreen onRetry={retry} retrying={isFetching} />;
  }

  // `replace` for the same reason `PrivateRoute`'s redirect is one: the app is
  // correcting the URL on its own behalf, and `NavigationGuardProvider` holds
  // back pushes only. A signed-in visitor goes where `returnTo` asked (a
  // template link that sent them to sign in), or to the app.
  return me ? (
    <Navigate to={signedInTarget(searchParams.get("returnTo"))} replace />
  ) : (
    <Outlet />
  );
};
