import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, fetchYorkieToken } from "./api/auth";
import { YorkieProvider } from "@yorkie-js/react";
import { OfflineRuntime } from "./components/offline-runtime";
import { getOfflinePersistenceEnabled } from "./lib/offline-persistence-preference";
import { supportsClientKey } from "./lib/yorkie-capabilities";

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

  const offlineInPlay = supportsClientKey() || getOfflinePersistenceEnabled();

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
          lifetime longer than one document. Renders nothing.

          Mounted only where the feature is in play. Its effect opens the
          IndexedDB database and issues an unfiltered `GET /documents` of its
          own on every signed-in session, and the design promises that
          declining the opt-in costs nothing — so a user who cannot even be
          offered the feature must not pay for it. `supportsClientKey()` is the
          build-time gate (below `MinClientKeyVersion` no durable client can
          mount, so nothing can be on the disk to keep); the preference is read
          beside it so a device that stored content under a *capable* build
          still gets its erase, sweep and reconcile if the pin is later rolled
          back. Neither term can flip while this is mounted — the pin is a
          constant, and every surface that can change the preference is itself
          behind `supportsClientKey()` — so this decides once and never churns
          the housekeeping underneath itself. */}
      {offlineInPlay && <OfflineRuntime userId={String(me.id)} />}
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
