import type { Document } from '@wafflebase/docs';
import type { CommentMarker } from '@wafflebase/docs';
import type { Tree } from '@yorkie-js/sdk';

import type { DocsRangeAnchor, Thread } from '@/types/comments.ts';

import { pathToDocPosition, resolveDocsAnchor } from './docs-anchor.ts';

/**
 * Build the marker list the docs editor should draw for the given
 * threads. Drops resolved threads, orphan threads, and threads whose
 * resolved path no longer maps to a live block.
 */
export function computeCommentMarkers(
  threads: ReadonlyArray<Thread<DocsRangeAnchor>>,
  doc: Document,
  tree: Pick<Tree, 'posRangeToPathRange'>,
): CommentMarker[] {
  const out: CommentMarker[] = [];
  for (const thread of threads) {
    if (thread.resolved) continue;
    const resolved = resolveDocsAnchor(tree, thread.anchor);
    if (resolved.kind !== 'live') continue;
    const anchor = pathToDocPosition(doc, resolved.startPath);
    const focus = pathToDocPosition(doc, resolved.endPath);
    if (!anchor || !focus) continue;
    out.push({ id: thread.id, anchor, focus });
  }
  return out;
}
