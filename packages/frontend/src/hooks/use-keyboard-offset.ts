import { useEffect, useState } from "react";

/**
 * Returns the current soft-keyboard height in CSS pixels.
 * Uses the visualViewport API to detect viewport shrinkage caused
 * by on-screen keyboards on mobile browsers.
 */
export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      setOffset(Math.max(0, window.innerHeight - vv.height));
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return offset;
}
