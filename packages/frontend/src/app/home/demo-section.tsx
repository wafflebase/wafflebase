import { useEffect, useRef, useState, type RefObject } from "react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { SectionHead } from "./primitives/section-head";

const DEMO_SHEET_TOKEN =
  import.meta.env.VITE_DEMO_SHARED_TOKEN ??
  "bed3dbe8-bdce-46ef-a76e-65fd67178cde";

const DEMO_DOC_TOKEN =
  import.meta.env.VITE_DEMO_DOC_SHARED_TOKEN ??
  "08fe575d-c5c0-451f-9b00-37d1833f68cc";

type Tab = "sheet" | "doc";

const TAB_ORDER: Tab[] = ["sheet", "doc"];

export function DemoSection() {
  const { resolvedTheme } = useTheme();
  const sheetIframeRef = useRef<HTMLIFrameElement>(null);
  const docIframeRef = useRef<HTMLIFrameElement>(null);
  const [tab, setTab] = useState<Tab>("sheet");
  const [docMounted, setDocMounted] = useState(false);
  const [sheetState, setSheetState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [docState, setDocState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  // Lock the iframe URLs to the initial theme so subsequent theme changes
  // don't mutate the `src` prop and trigger a full reload — theme updates
  // flow through postMessage instead (see effect below).
  const [sheetUrl] = useState(
    () =>
      `${window.location.origin}/shared/${DEMO_SHEET_TOKEN}?theme=${resolvedTheme}`,
  );
  const [docUrl] = useState(
    () =>
      `${window.location.origin}/shared/${DEMO_DOC_TOKEN}?theme=${resolvedTheme}`,
  );

  // Mount the doc iframe lazily, on first activation of the doc tab,
  // so the initial pageload only fetches the sheet iframe.
  useEffect(() => {
    if (tab === "doc") setDocMounted(true);
  }, [tab]);

  // Forward theme changes to live iframes via postMessage so they update
  // without reloading.
  useEffect(() => {
    postTheme(sheetIframeRef, sheetState === "loaded", resolvedTheme);
    postTheme(docIframeRef, docState === "loaded", resolvedTheme);
  }, [resolvedTheme, sheetState, docState]);

  const handleTabKey = (e: React.KeyboardEvent, key: Tab) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = TAB_ORDER.indexOf(key);
    const next =
      e.key === "ArrowRight"
        ? TAB_ORDER[(idx + 1) % TAB_ORDER.length]
        : TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    setTab(next);
    document.getElementById(`demo-tab-${next}`)?.focus();
  };

  return (
    <section
      id="demo"
      className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8"
    >
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          kicker="Live demo"
          title="Try it live"
          sub="Edit cells, type formulas, see updates instantly. Both panes are real Wafflebase documents running in your browser."
        />

        <div
          className="max-w-[960px] mx-auto rounded-[18px] border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] overflow-hidden"
          style={{
            boxShadow:
              "0 30px 60px -30px color-mix(in srgb, var(--wb-syrup-deep) 22%, transparent)",
          }}
        >
          {/* Tab bar */}
          <div
            role="tablist"
            aria-label="Live demo surface"
            className="flex items-center gap-1 px-2 pt-2 border-b border-[color:var(--wb-rule)]"
            style={{
              background:
                "color-mix(in srgb, var(--wb-rule) 20%, var(--wb-paper))",
            }}
          >
            <DemoTab
              active={tab === "sheet"}
              onClick={() => setTab("sheet")}
              onKeyDown={(e) => handleTabKey(e, "sheet")}
              icon={<SheetIcon />}
              label="Spreadsheet"
              tabId="demo-tab-sheet"
              panelId="demo-panel-sheet"
            />
            <DemoTab
              active={tab === "doc"}
              onClick={() => setTab("doc")}
              onKeyDown={(e) => handleTabKey(e, "doc")}
              icon={<DocIcon />}
              label="Word processor"
              tabId="demo-tab-doc"
              panelId="demo-panel-doc"
            />
            <span className="flex-1" />
          </div>

          {/* Tab body — both iframes stay mounted once activated, so tab
              switching never reloads. */}
          <div className="relative w-full aspect-[4/3] md:aspect-video">
            <DemoFrame
              visible={tab === "sheet"}
              iframeRef={sheetIframeRef}
              src={sheetUrl}
              title="Wafflebase live demo spreadsheet"
              state={sheetState}
              panelId="demo-panel-sheet"
              tabId="demo-tab-sheet"
              onLoad={() => setSheetState("loaded")}
              onError={() => setSheetState("error")}
            />
            {docMounted && (
              <DemoFrame
                visible={tab === "doc"}
                iframeRef={docIframeRef}
                src={docUrl}
                title="Wafflebase live demo document"
                state={docState}
                panelId="demo-panel-doc"
                tabId="demo-tab-doc"
                onLoad={() => setDocState("loaded")}
                onError={() => setDocState("error")}
              />
            )}
          </div>

          {/* Footer */}
          <div
            className="flex justify-between items-center px-4 md:px-5 py-3 border-t border-[color:var(--wb-rule)] font-code text-[12px] text-[color:var(--wb-sub)]"
            style={{
              background:
                "color-mix(in srgb, var(--wb-rule) 20%, var(--wb-paper))",
            }}
          >
            <span className="truncate pr-3">
              {tab === "sheet"
                ? "Tip: double-click a cell to edit. Totals recompute on the same engine."
                : "Tip: edit any paragraph or heading — collaboration and formulas stay live."}
            </span>
            <span className="shrink-0">wafflebase@0.3.6</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function postTheme(
  ref: RefObject<HTMLIFrameElement | null>,
  loaded: boolean,
  theme: string,
) {
  if (!loaded || !ref.current?.contentWindow) return;
  ref.current.contentWindow.postMessage(
    { type: "theme-change", theme },
    window.location.origin,
  );
}

type DemoFrameProps = {
  visible: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  src: string;
  title: string;
  state: "loading" | "loaded" | "error";
  panelId: string;
  tabId: string;
  onLoad: () => void;
  onError: () => void;
};

function DemoFrame({
  visible,
  iframeRef,
  src,
  title,
  state,
  panelId,
  tabId,
  onLoad,
  onError,
}: DemoFrameProps) {
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={!visible}
      className="absolute inset-0"
      style={{ display: visible ? "block" : "none" }}
    >
      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[color:var(--wb-paper)] gap-3">
          <div className="size-6 border-2 border-[color:var(--wb-rule)] border-t-[color:var(--wb-syrup)] rounded-full animate-spin" />
          <div className="text-[color:var(--wb-sub)] text-sm">Loading demo…</div>
        </div>
      )}
      {state === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--wb-paper)] text-[color:var(--wb-sub)] text-sm">
          Demo unavailable. Try refreshing the page.
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={src}
          title={title}
          className="w-full h-full border-0"
          loading="lazy"
          allow="clipboard-read; clipboard-write"
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}

type DemoTabProps = {
  active: boolean;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  icon: React.ReactNode;
  label: string;
  tabId: string;
  panelId: string;
};

function DemoTab({
  active,
  onClick,
  onKeyDown,
  icon,
  label,
  tabId,
  panelId,
}: DemoTabProps) {
  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-2 px-3.5 pt-2.5 pb-3 -mb-px font-body text-[13.5px] font-medium border-b-2 rounded-t-lg cursor-pointer transition-colors",
        active
          ? "text-[color:var(--wb-ink)] bg-[color:var(--wb-paper)] border-[color:var(--wb-syrup)]"
          : "text-[color:var(--wb-sub)] bg-transparent border-transparent hover:text-[color:var(--wb-ink)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SheetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M1 5h12M1 9h12M5 1v12M9 1v12"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.6"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect
        x="2"
        y="1"
        width="10"
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M4 4h6M4 7h6M4 10h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
