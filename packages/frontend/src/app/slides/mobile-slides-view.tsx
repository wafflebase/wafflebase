import { useDocument } from "@yorkie-js/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { Loader } from "@/components/loader";
import { usePointerSwipe } from "@/hooks/use-pointer-swipe";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { SlidesPresence } from "@/types/users";
import { SlidesPresentationMode } from "./slides-presentation-mode";
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from "./yorkie-slides-store";

interface MobileSlidesViewProps {
  documentId: string;
  /** Page title from the Documents API. Falls back to Yorkie meta title. */
  title?: string;
  /** Override the back action; defaults to `navigate(-1)`. */
  onBack?: () => void;
}

/**
 * Read-only mobile shell for the slides editor. Mounted by
 * `slides-detail.tsx`'s `SlidesLayout` when `useIsMobile()` is true,
 * replacing the full desktop chrome (sidebar / site header / toolbar
 * / SlidesView). The editor module is intentionally not mounted —
 * read-only is enforced by construction.
 *
 * The canvas painting wiring lands in the next commit. This commit
 * builds out the React shell, navigation state, swipe gesture, and
 * Present-mode launch so the structure is reviewable on its own.
 */
export function MobileSlidesView({
  title,
  onBack,
}: MobileSlidesViewProps) {
  const navigate = useNavigate();
  const { doc, loading, error } = useDocument<
    YorkieSlidesRoot,
    SlidesPresence
  >();

  // Build the store once per `doc`. We keep the store around so the
  // Present button can hand it to `<SlidesPresentationMode>` without
  // re-wrapping on every render. Disposed in cleanup.
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  useEffect(() => {
    if (!doc) return;
    ensureSlidesRoot(doc);
    const s = new YorkieSlidesStore(doc);
    setStore(s);
    return () => {
      s.dispose();
      setStore(null);
    };
  }, [doc]);

  // Snapshot of the parts of the deck the mobile shell renders.
  // Refreshed whenever the store fires `onChange` (covers local writes
  // — though we don't issue any here — and remote peer edits).
  const [snapshot, setSnapshot] = useState<{
    title: string;
    slideIds: string[];
  }>({ title: title ?? "", slideIds: [] });

  useEffect(() => {
    if (!store) return;
    const refresh = () => {
      const r = store.read();
      setSnapshot({
        title: title ?? r.meta?.title ?? "Untitled",
        slideIds: r.slides.map((s) => s.id),
      });
    };
    refresh();
    return store.onChange(refresh);
  }, [store, title]);

  const [currentSlideId, setCurrentSlideId] = useState<string>("");
  useEffect(() => {
    if (snapshot.slideIds.length === 0) {
      setCurrentSlideId("");
      return;
    }
    setCurrentSlideId((id) =>
      snapshot.slideIds.includes(id) ? id : snapshot.slideIds[0],
    );
  }, [snapshot.slideIds]);

  const currentIndex = useMemo(
    () => snapshot.slideIds.indexOf(currentSlideId),
    [snapshot.slideIds, currentSlideId],
  );

  const nextSlide = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= snapshot.slideIds.length - 1) return;
    setCurrentSlideId(snapshot.slideIds[currentIndex + 1]);
  }, [currentIndex, snapshot.slideIds]);

  const prevSlide = useCallback(() => {
    if (currentIndex <= 0) return;
    setCurrentSlideId(snapshot.slideIds[currentIndex - 1]);
  }, [currentIndex, snapshot.slideIds]);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const swipeOptions = useMemo(
    () => ({ onSwipeLeft: nextSlide, onSwipeRight: prevSlide }),
    [nextSlide, prevSlide],
  );
  usePointerSwipe(canvasHostRef, swipeOptions);

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else navigate(-1);
  }, [onBack, navigate]);

  const [presentingFrom, setPresentingFrom] = useState<"current" | null>(null);
  const handlePresent = useCallback(() => {
    if (!store || store.read().slides.length === 0) return;
    setPresentingFrom("current");
  }, [store]);

  const presentationStartSlideId =
    presentingFrom && currentSlideId ? currentSlideId : undefined;

  if (loading) return <Loader />;
  if (error) {
    return (
      <div role="alert" style={{ padding: 16 }}>
        Failed to load deck.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxHeight: "100vh",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          height: 44,
          padding: "0 8px",
          gap: 8,
          borderBottom: "1px solid #e5e7eb",
          flexShrink: 0,
          background: "#fff",
        }}
      >
        <button
          type="button"
          aria-label="Back to deck list"
          onClick={handleBack}
          style={{
            width: 36,
            height: 36,
            fontSize: 22,
            background: "transparent",
            border: 0,
            cursor: "pointer",
          }}
        >
          ‹
        </button>
        <h1
          style={{
            flex: 1,
            fontSize: 16,
            fontWeight: 500,
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {snapshot.title || "Untitled"}
        </h1>
        <button
          type="button"
          aria-label="Start presentation"
          onClick={handlePresent}
          disabled={snapshot.slideIds.length === 0}
          style={{
            width: 36,
            height: 36,
            fontSize: 16,
            background: "transparent",
            border: 0,
            cursor: snapshot.slideIds.length === 0 ? "not-allowed" : "pointer",
            opacity: snapshot.slideIds.length === 0 ? 0.4 : 1,
          }}
        >
          ▶
        </button>
      </header>

      <div
        ref={canvasHostRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          touchAction: "pan-y",
        }}
      >
        {/* Canvas mounts here in Task 3. */}
      </div>

      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          height: 28,
          fontSize: 13,
          flexShrink: 0,
          borderTop: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <button
          type="button"
          aria-label="Previous slide"
          onClick={prevSlide}
          disabled={currentIndex <= 0}
          style={{
            minWidth: 32,
            background: "transparent",
            border: 0,
            cursor: currentIndex <= 0 ? "not-allowed" : "pointer",
            opacity: currentIndex <= 0 ? 0.4 : 1,
          }}
        >
          ‹
        </button>
        <span>
          {Math.max(currentIndex + 1, 0)} / {snapshot.slideIds.length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          onClick={nextSlide}
          disabled={currentIndex >= snapshot.slideIds.length - 1}
          style={{
            minWidth: 32,
            background: "transparent",
            border: 0,
            cursor:
              currentIndex >= snapshot.slideIds.length - 1
                ? "not-allowed"
                : "pointer",
            opacity:
              currentIndex >= snapshot.slideIds.length - 1 ? 0.4 : 1,
          }}
        >
          ›
        </button>
      </footer>

      {presentingFrom && store && presentationStartSlideId && (
        <SlidesPresentationMode
          store={store}
          startSlideId={presentationStartSlideId}
          onExit={() => setPresentingFrom(null)}
        />
      )}
    </div>
  );
}
