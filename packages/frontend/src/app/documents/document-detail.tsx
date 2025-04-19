import { useParams } from "react-router-dom";
import { setup } from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const [didMount, setDidMount] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    async function setupSpreadsheet() {
      if (!didMount) {
        return;
      }

      const cleanup = await setup(containerRef.current!, {
        theme: 'dark',
      });
      cleanupRef.current = cleanup;
    }
    setupSpreadsheet();

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [didMount, containerRef]);

  return (
    <div className="h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export default DocumentDetail;
