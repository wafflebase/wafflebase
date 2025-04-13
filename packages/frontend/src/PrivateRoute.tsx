import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useMe } from "./hooks/useMe";
import { Loader } from "./components/loader";

export const PrivateRoute = (): ReactElement => {
  const { me, isLoading } = useMe();

  if (isLoading) {
    return <Loader />;
  }

  return me ? <Outlet /> : <Navigate to="/login" />;
};
