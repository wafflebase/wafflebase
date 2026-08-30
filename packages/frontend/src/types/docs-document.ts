import type { DocsRangeAnchor, Thread } from '@/types/comments.ts';

/**
 * Yorkie document root for the docs (rich-text) editor.
 *
 * - `content`: yorkie.Tree holding the block/inline structure
 * - `pageSetup`: document-level metadata (paper size, margins)
 * - `stylesJson`: named-style overrides registry (`DocStyles`) serialized as
 *   a JSON string. A tiny, rarely-concurrent registry — whole-blob LWW is
 *   acceptable and a scalar string avoids Yorkie proxy double-encoding.
 *   Existing documents without the field resolve to built-in styles.
 * - `comments`: threaded comments keyed by thread id, materialized on
 *   first insertion. Existing documents without the field stay valid.
 */
export type YorkieDocsRoot = {
  content: Tree;
  pageSetup?: {
    paperSize: { name: string; width: number; height: number };
    orientation: 'portrait' | 'landscape';
    margins: { top: number; bottom: number; left: number; right: number };
  };
  stylesJson?: string;
  comments?: { [threadId: string]: Thread<DocsRangeAnchor> };
};

/**
 * Initial Yorkie document root for a new docs document.
 *
 * Deliberately seeds no `content`. It used to, on the reasoning that
 * creating the Tree inside `client.attach({ initialRoot })` keeps the setup
 * off the undo stack (yorkie-js-sdk PR #1238) — otherwise a long enough
 * Cmd+Z unwinds it, destroys the initial block and crashes
 * `text-editor.handleInput` with "Block not found".
 *
 * That reasoning was sound but the code never delivered it. A `Tree` is
 * recognized by `instanceof` against the class belonging to whichever copy
 * of the SDK owns the document, and this module is shared by two of them:
 * `@yorkie-js/react`'s `DocumentProvider` bundles its own SDK (the editor
 * routes and share links), while `apply-imported-content` drives a plain
 * `@yorkie-js/sdk` client. A Tree built from either one is unrecognized by
 * the other and materializes as a plain `CRDTObject`, so whichever class
 * this file picked, one path got a placeholder rather than a Tree.
 *
 * Seeding nothing removes the choice instead of moving it, and costs
 * nothing, because every consumer already creates the Tree in its own
 * realm: `ensureTree` in `docs-view.tsx` for the provider paths (calling
 * `clearHistory()` afterwards, which is what preserves the undo property
 * above), `writeFullDocument` for the import path, and the backend's own
 * `writeDocsRoot`. It also removes a write: attach used to store a
 * placeholder that `ensureTree` overwrote a moment later.
 *
 * `comments` stays. It is a plain object, so no class identity is involved.
 *
 * `comments` is initialized to an empty map for the same reason it must
 * be created once: Yorkie resolves concurrent assignment of the same
 * object key by LWW. If the container were instead lazily created on
 * first comment (`if (!root.comments) root.comments = {}`), two users
 * adding the first comment concurrently would each create a fresh map
 * and one would be discarded wholesale, losing a thread. Seeding it at
 * bootstrap means all replicas share one container and concurrent
 * inserts only set distinct keys, which merge cleanly.
 */
/**
 * The root a share-link visitor should attach with, given their role.
 *
 * The Yorkie SDK writes every `initialRoot` key the document does not
 * already have, on each attach — so seeding from a viewer's client means a
 * viewer creates `comments` on a never-edited document just by opening the
 * link. That is a write to a shared document from the one role that must
 * not make them, and it happens before any of the editor's read-only
 * machinery exists.
 *
 * Nothing a viewer can do needs it: every `root.comments` read is
 * existence-guarded, an editor's first comment creates the container lazily,
 * and commenting is `readOnly`-gated. The LWW argument above is about two
 * *editors* racing on a first comment, and editors still seed.
 */
export function docsInitialRootForRole(
  role: string,
): Partial<YorkieDocsRoot> {
  return role === 'viewer' ? {} : initialDocsRoot();
}
export function initialDocsRoot(): Partial<YorkieDocsRoot> {
  return { comments: {} };
}
