import { initialize, Spreadsheet } from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import { useDocument } from "@yorkie-js/react";
import { Worksheet } from "@/types/worksheet";
import { YorkieStore } from "./yorkie-store";
import { UserPresence } from "@/types/users";

export function SheetView() {
  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const sheetRef = useRef<Spreadsheet | undefined>(undefined);
  const { doc, loading, error } = useDocument<Worksheet, UserPresence>();

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

    let sheet: Awaited<ReturnType<typeof initialize>> | undefined;
    let unsubs: Array<Function> = [];
    let cancelled = false;

    initialize(container, {
      theme,
      store: new YorkieStore(doc),
    }).then((s) => {
      if (cancelled) {
        s.cleanup();
        return;
      }

      sheet = s;
      sheetRef.current = s;

      // TODO(hackerwins): We need to optimize the rendering performance.
      unsubs.push(
        doc.subscribe((e) => {
          if (e.type === "remote-change") {
            sheet!.reloadDimensions().then(() => sheet!.render());
          }
        })
      );
      unsubs.push(doc.subscribe("presence", () => sheet!.renderOverlay()));
    });

    return () => {
      cancelled = true;
      if (sheet) {
        sheet.cleanup();
      }
      sheetRef.current = undefined;

      for (const unsub of unsubs) {
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
