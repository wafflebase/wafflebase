import { ReactElement, useCallback } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, fetchYorkieToken, isBackendUnreachableError } from "./api/auth";
import { OfflineScreen } from "./components/offline-screen";
import { YorkieProvider } from "@yorkie-js/react";
import { ChatStreamHost } from "./components/chat/chat-stream-host";

/**
 * Guards routes that require authenticated access.
 */
export const PrivateRoute = (): ReactElement => {
  const { data: me, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
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

  return me ? (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: encodeURIComponent(me.username || "anonymous-user") }}
      authTokenInjector={fetchYorkieToken}
    >
      <ChatStreamHost />
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
