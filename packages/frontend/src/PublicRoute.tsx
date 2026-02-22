import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./components/loader";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "./api/auth";

export const PublicRoute = (): ReactElement => {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me", "optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  if (isLoading) {
    return <Loader />;
  }

  return me ? <Navigate to="/" /> : <Outlet />;
};
