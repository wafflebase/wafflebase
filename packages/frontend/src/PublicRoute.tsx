import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "./api/auth";

/**
 * Redirects authenticated users away from public-only routes.
 */
export const PublicRoute = (): ReactElement => {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me", "optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  if (isLoading) {
    return <Loader />;
  }

  // `replace` for the same reason `PrivateRoute`'s redirect is one: the app is
  // correcting the URL on its own behalf, and `NavigationGuardProvider` holds
  // back pushes only.
  return me ? <Navigate to="/" replace /> : <Outlet />;
};
