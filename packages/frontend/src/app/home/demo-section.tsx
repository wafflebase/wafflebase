import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";

const DEMO_TOKEN =
  import.meta.env.VITE_DEMO_SHARED_TOKEN ??
  "bed3dbe8-bdce-46ef-a76e-65fd67178cde";

export function DemoSection() {
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  const [error, setError] = useState(false);
  const demoUrl = `${window.location.origin}/shared/${DEMO_TOKEN}?theme=${resolvedTheme}`;

  // Sync iframe theme via postMessage when theme changes after initial load
  useEffect(() => {
    if (!loaded || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: "theme-change", theme: resolvedTheme },
      window.location.origin,
    );
  }, [resolvedTheme, loaded]);

  return (
    <section className="bg-homepage-bg px-4 md:px-12 pb-15 text-center">
      <div className="max-w-[960px] mx-auto rounded-xl border border-border shadow-xl overflow-hidden">
        <div className="bg-muted px-4 py-2.5 flex gap-1.5 items-center border-b border-border">
          <div className="size-2.5 rounded-full bg-[#FF5F57]" />
          <div className="size-2.5 rounded-full bg-[#FEBC2E]" />
          <div className="size-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="w-full aspect-video relative">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="text-muted-foreground text-sm">Loading demo...</div>
            </div>
          )}
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <img
                src="/images/screenshot-demo.png"
                alt="Wafflebase spreadsheet"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={demoUrl}
              title="Wafflebase live demo spreadsheet"
              className="w-full h-full border-0"
              loading="lazy"
              allow="clipboard-read; clipboard-write"
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-4 italic">
        Try it live — this is a real Wafflebase spreadsheet
      </p>
    </section>
  );
}
