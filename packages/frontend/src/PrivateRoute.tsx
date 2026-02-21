import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "./api/auth";
import { YorkieProvider } from "@yorkie-js/react";

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
      apiKey={import.meta.env.VITE_YORKIE_API_KEY}
      metadata={{ userID: me.username || "anonymous-user" }}
    >
      <Outlet />
    </YorkieProvider>
  ) : (
    <Navigate to="/login" />
  );
};
