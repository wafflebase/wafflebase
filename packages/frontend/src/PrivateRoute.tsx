import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, fetchYorkieToken } from "./api/auth";
import { YorkieProvider } from "@yorkie-js/react";
import { OfflineRuntime } from "./components/offline-runtime";

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
      {/* The offline feature's housekeeping — the erase-on-disable watcher,
          the thirty-day sweep, and the offer of work that could not be
          reconciled. Here because every one of those happens when no editor is
          mounted, and this is the only place with both an identity and a
          lifetime longer than one document. Renders nothing. */}
      <OfflineRuntime userId={String(me.id)} />
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
