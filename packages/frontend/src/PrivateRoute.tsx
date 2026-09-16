import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, fetchYorkieToken } from "./api/auth";
import { YorkieProvider } from "@yorkie-js/react";

/**
 * Guards routes that require authenticated access.
 */
export const PrivateRoute = (): ReactElement => {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  if (isLoading) {
    return <Loader />;
  }

  return me ? (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: encodeURIComponent(me.username || "anonymous-user") }}
      authTokenInjector={fetchYorkieToken}
    >
      <Outlet />
    </YorkieProvider>
  ) : (
    // `replace`, not a push: this is the app correcting the URL on its own
    // behalf, so it must not be refusable by `NavigationGuardProvider` (which
    // guards pushes only) and must not leave a back-button entry pointing at a
    // route that would immediately bounce the user here again.
    <Navigate to="/login" replace />
  );
};
