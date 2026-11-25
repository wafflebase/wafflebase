import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { decodeAnchor, type ChatDocumentAnchor } from "./document-link";

/**
 * How long after its first attempt an anchor whose target was not found is
 * still retried. `ready` says the editor is mounted, not that the content
 * it reads has all arrived, so a miss right after mount may only be early;
 * past this, a miss is taken as a target deleted since the link was sent,
 * and a late hit would pull the user back from wherever they have gone.
 */
export const ANCHOR_RETRY_MS = 5_000;

/**
 * Applies the page's `?at=` anchor (`docs/design/chat.md` § Document Cards
 * and Anchors) once the editor is `ready`: `apply` succeeds at most once per
 * distinct `?at=` value, so a re-render, a remote edit or the user moving on
 * never pulls the selection back, while a second card for the same document
 * — a new value — does. A value that does not decode for `type` is ignored.
 *
 * `apply` returns whether it found the anchor's target and moved there. A
 * miss (a row, block or slide not present) is retried on later renders for
 * up to `ANCHOR_RETRY_MS`, then dropped: the document itself is still the
 * right place. The parameter is left in the URL, like `?chat=`.
 */
export function useAnchorParam<T extends ChatDocumentAnchor>(
  type: string,
  ready: boolean,
  apply: (anchor: T) => boolean,
): void {
  const [params] = useSearchParams();
  const raw = params.get("at");
  // The value settled (applied, given up on, or undecodable), and the value
  // being attempted with when its first attempt ran.
  const settled = useRef<string | null>(null);
  const attempt = useRef<{ raw: string; since: number } | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Every render while unsettled: the content an anchor names can arrive
  // without any of this hook's inputs changing.
  useEffect(() => {
    if (!ready || !raw || settled.current === raw) return;
    const anchor = decodeAnchor(raw, type);
    if (!anchor) {
      settled.current = raw;
      return;
    }
    const now = Date.now();
    if (attempt.current?.raw !== raw) attempt.current = { raw, since: now };
    if (applyRef.current(anchor as T)) {
      settled.current = raw;
    } else if (now - attempt.current.since >= ANCHOR_RETRY_MS) {
      settled.current = raw;
    }
  });
}
