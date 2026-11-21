import { useEffect, useRef, useState } from "react";

/** How long a deep-linked message keeps its highlight. */
const FLASH_MS = 2000;

/**
 * Scroll a deep-linked message into view and highlight it briefly, once per
 * target. `present` says whether the message is rendered yet: a link can name
 * a message on a page still loading, and the flash waits for it.
 */
export function useFlashMessage(
  targetId: string | null | undefined,
  present: boolean,
): string | null {
  const [flashing, setFlashing] = useState<string | null>(null);
  const done = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!targetId || !present || done.current === targetId) return;
    done.current = targetId;
    const el = document.getElementById(`chat-message-${targetId}`);
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView?.({
      block: "center",
      behavior: reduced ? "auto" : "smooth",
    });
    setFlashing(targetId);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlashing(null), FLASH_MS);
  }, [targetId, present]);

  return flashing;
}
