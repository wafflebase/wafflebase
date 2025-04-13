import { useState, useEffect } from "react";
import { User } from "@/types/users";

export function useMe() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // 로딩 상태 추가
  const [didMount, setDidMount] = useState(false);

  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      if (!didMount) return;

      setIsLoading(true); // 로딩 시작
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_API_URL}/auth/me`,
          {
            method: "GET",
            credentials: "include",
          }
        );
        if (res.ok) {
          setUser(await res.json());
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Failed to fetch user:", error);
        setUser(null);
      } finally {
        setIsLoading(false); // 로딩 종료
      }
    };
    fetchUser();
  }, [didMount]);

  return { me: user, isLoading }; // 로딩 상태와 사용자 정보 반환
}
