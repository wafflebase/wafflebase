import { useDocument } from "@yorkie-js/react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { useEffect } from "react";
import { Worksheet } from "@/types/worksheet";
import { UserPresence } from "@/types/users";

export function usePresenceUpdater() {
  const { doc } = useDocument<Worksheet, UserPresence>();
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
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
      });
    });
  }, [doc, currentUser]);
}
