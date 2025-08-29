import { useDocument } from "@yorkie-js/react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { useEffect } from "react";

export function usePresenceUpdater() {
  const { doc } = useDocument();
  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  useEffect(() => {
    if (!doc || !currentUser) return;

    // Update presence when user data is available
    doc.update((_, presence) => {
      presence.set({
        userID: currentUser.username,
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
      });
    });
  }, [doc, currentUser]);
}
