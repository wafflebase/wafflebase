import { initialize } from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import { useDocument } from "@yorkie-js/react";
import { Worksheet } from "@/types/worksheet";
import { YorkieStore } from "./yorkie-store";

export function SheetView() {
  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<Worksheet>();

  // NOTE(hackerwins): To prevent initialization of the spreadsheet
  // twice in development.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) {
      return;
    }

    const sheet = initialize(container, {
      theme,
      store: new YorkieStore(doc),
    });
    const unsub = doc.subscribe((e) => {
      if (e.type === "remote-change") {
        sheet.render();
      }
    });

    return () => {
      if (sheet) {
        sheet.cleanup();
      }

      if (unsub) {
        unsub();
      }
    };
  }, [didMount, containerRef, doc]);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export default SheetView;
