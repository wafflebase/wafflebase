import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { acceptInvite } from "@/api/workspaces";

/**
 * Accepts a workspace invite via token and redirects to the workspace.
 */
export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    acceptInvite(token)
      .then(({ workspaceId }) =>
        navigate(`/w/${workspaceId}`, { replace: true }),
      )
      .catch((err) => setError(err.message || "Failed to accept invite"));
  }, [token, navigate]);

  if (error) {
    return <div className="p-8 text-center text-red-500">{error}</div>;
  }

  return <div className="p-8 text-center">Accepting invite...</div>;
}
