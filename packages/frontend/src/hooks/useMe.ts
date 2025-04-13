import { useState, useEffect } from "react";
import { User } from "@/types/users";
import { fetchMe } from "@/api/auth";

export function useMe() {
  const [user, setUser] = useState<User | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [didMount, setDidMount] = useState(false);

  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      if (!didMount) return;

      setIsLoading(true);
      setUser(await fetchMe());
      setIsLoading(false);
    };
    fetchUser();
  }, [didMount]);

  return { me: user, isLoading };
}
