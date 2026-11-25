import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { decodeAnchor, type ChatDocumentAnchor } from "./document-link";

/**
 * Applies the page's `?at=` anchor (`docs/design/chat.md` § Document Cards
 * and Anchors) once the editor is `ready`: `apply` runs at most once per
 * distinct `?at=` value, so a re-render, a remote edit or the user moving on
 * never pulls the selection back, while a second card for the same document
 * — a new value — does. A value that does not decode for `type` is ignored.
 *
 * `apply` decides what a stale anchor means (a deleted row, block or slide):
 * it should do nothing, since the document itself is still the right place.
 * The parameter is left in the URL, like `?chat=`.
 */
export function useAnchorParam<T extends ChatDocumentAnchor>(
  type: string,
  ready: boolean,
  apply: (anchor: T) => void,
): void {
  const [params] = useSearchParams();
  const raw = params.get("at");
  const applied = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!ready || !raw || applied.current === raw) return;
    applied.current = raw;
    const anchor = decodeAnchor(raw, type);
    if (anchor) applyRef.current(anchor as T);
  }, [raw, ready, type]);
}
