import { initialize, Spreadsheet } from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";

export function DocumentDetail() {
  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const [spreadsheet, setSpreadsheet] = useState<Spreadsheet | null>(null);

  // NOTE(hackerwins): To prevent initialization of the spreadsheet
  // twice in development.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container) {
      return;
    }

    setSpreadsheet(initialize(container, { theme }));

    return () => {
      if (spreadsheet) {
        spreadsheet.cleanup();
        setSpreadsheet(null);
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
