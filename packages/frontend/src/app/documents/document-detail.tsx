import { setup } from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";

export function DocumentDetail() {
  const { theme } = useTheme();
  const [didMount, setDidMount] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // NOTE(hackerwins): To prevent the setup from being called twice
  // by React.StrictMode in development mode.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container) {
      return;
    }

    (async () => {
      const cleanup = await setup(container, {
        theme: theme,
      });
      cleanupRef.current = cleanup;
    })();

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [didMount]);

  return (
    <div className="h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export default DocumentDetail;
