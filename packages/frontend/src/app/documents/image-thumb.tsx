import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { fetchWithAuth } from "@/api/auth";
import { fileUrl } from "@/api/files";
import { canThumbnail } from "./image-thumb-size";

/**
 * Small inline thumbnail for an `image` document row. Client-side downscale
 * (no server thumbnails): the full blob is fetched — but only once the row is
 * scrolled into view, and only when it is at most `MAX_THUMB_SOURCE_BYTES` —
 * and the browser scales it into the fixed box. The object URL is revoked on
 * unmount to avoid leaks across list re-renders.
 */
export function ImageThumb({
  documentId,
  fileSize,
}: {
  documentId: string;
  /** The document's `fileSize`. Required so a caller cannot forget it and
   *  silently fall back to the icon for every row. */
  fileSize: number | null | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const eligible = canThumbnail(fileSize);

  useEffect(() => {
    const el = ref.current;
    if (!el || !eligible) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetchWithAuth(fileUrl(documentId), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    });
    observer.observe(el);

    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, eligible]);

  return (
    <div
      ref={ref}
      className="h-4 w-4 shrink-0 overflow-hidden rounded-sm bg-muted"
    >
      {eligible && src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-4 w-4 text-type-image" />
      )}
    </div>
  );
}
