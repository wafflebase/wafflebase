/**
 * Finding and rewriting the workspace-scoped image references inside a copied
 * document (docs/design/template-gallery.md, *Cross-workspace image
 * re-hosting*).
 *
 * Kept separate from `DocumentCopyService` and free of S3 and Prisma, because
 * the part worth testing exhaustively is which strings are *eligible* — that is
 * where the authorization rule lives, and it is a pure decision.
 */

/**
 * Depth ceiling for the walk. A Yorkie root is a plain JSON snapshot with no
 * cycles, so this is not a cycle guard — it bounds the one thing a hostile or
 * corrupt document could otherwise do here, which is blow the stack.
 */
const MAX_DEPTH = 64;

/**
 * The workspace-scoped image *path*, matched against a whole pathname and
 * nothing less: `/api/v1/workspaces/{workspaceId}/images/{imageId}`.
 *
 * Anchored at both ends deliberately. An earlier revision anchored only at a
 * `/` boundary, so a sheet cell reading `"Logo: /api/v1/…/x.png"` parsed as a
 * reference whose `url` was the *entire cell* — and the rewrite then replaced
 * the whole string, deleting the prose around it. A reference is the string or
 * it is not a reference.
 *
 * `imageId` is deliberately narrow — a uuid plus a known image extension, the
 * same shape `VALID_IMAGE_ID_PATTERN` accepts — so a reference that has been
 * tampered with to name some other storage key cannot be laundered into a
 * fresh servable id by this path.
 */
const WORKSPACE_IMAGE_PATH =
  /^\/api\/v1\/workspaces\/([A-Za-z0-9_-]{1,200})\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp))$/i;

/** One workspace-scoped image reference found somewhere in a document. */
export interface ImageRef {
  /** The string exactly as stored, so a rewrite replaces it and nothing else. */
  url: string;
  /** The workspace the URL names — *claimed*, not verified. */
  workspaceId: string;
  /** The image id within that workspace. */
  imageId: string;
}

/**
 * Parse a stored string as a first-party workspace-scoped image reference.
 *
 * Two gates, and both are security boundaries rather than tidiness:
 *
 * - **Origin.** A stored reference is absolute whenever the deployment sets an
 *   API base (`resolveImageUrl` in the frontend prepends it), so absolute URLs
 *   cannot simply be refused. But the string comes out of the CRDT, where any
 *   collaborator can write `https://attacker.example/api/v1/workspaces/…`. An
 *   absolute URL is therefore accepted only when its origin is this
 *   deployment's own — the same rule, for the same reason, that
 *   `isTrustedWorkspaceImageUrl` applies in
 *   `packages/frontend/src/api/share-image-url.ts`. With no configured origin
 *   only root-relative references are accepted, which is the safe direction.
 * - **Whole-string match.** See {@link WORKSPACE_IMAGE_PATH}.
 *
 * A query or fragment is refused rather than stripped: nothing in this codebase
 * writes one, so its presence means the string is not the shape this function
 * claims to understand.
 */
export function parseImageRef(
  value: unknown,
  trustedOrigin?: string,
): ImageRef | null {
  if (typeof value !== 'string' || value.length > 2048) return null;

  let pathname: string;
  if (value.startsWith('/') && !value.startsWith('//')) {
    // Root-relative, so it resolves against our own origin by construction.
    // `//host/…` is protocol-relative and is *not* root-relative, which is the
    // spelling this check exists to exclude.
    if (/[?#]/.test(value)) return null;
    pathname = value;
  } else {
    if (!trustedOrigin) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.origin !== trustedOrigin) return null;
    if (url.search || url.hash) return null;
    pathname = url.pathname;
  }

  const match = WORKSPACE_IMAGE_PATH.exec(pathname);
  if (!match) return null;
  return { url: value, workspaceId: match[1], imageId: match[2] };
}

/**
 * Whether this reference may be re-hosted when copying out of
 * `sourceWorkspaceId`.
 *
 * **The workspace in the URL is checked, never trusted.** That id sits in
 * document content its author wrote, so a reference naming someone else's
 * workspace is an ordinary thing for a document to contain — and re-hosting it
 * would have the server read an image out of a workspace the copier cannot
 * reach and write it somewhere they can. A reference the source workspace was
 * not itself entitled to serve is left exactly as it is, where it goes on
 * 403-ing for the copy as it did for the original.
 */
export function isRehostable(
  ref: ImageRef,
  sourceWorkspaceId: string,
): boolean {
  return ref.workspaceId === sourceWorkspaceId;
}

/** How the re-hosted object is addressed in the destination workspace. */
export function workspaceImageUrl(
  workspaceId: string,
  imageId: string,
): string {
  return `/api/v1/workspaces/${workspaceId}/images/${imageId}`;
}

/** What one walk of a document found. */
export interface CollectedRefs {
  /** References the source workspace owns, so re-hosting them is permitted. */
  rehostable: ImageRef[];
  /**
   * First-party references naming a *different* workspace. Returned rather
   * than dropped: they will 403 in the copy, and a caller deciding whether to
   * publish has to be told that rather than shown an empty report.
   */
  foreign: ImageRef[];
  /** True if the walk stopped early, so the result may be incomplete. */
  truncated: boolean;
}

/**
 * Every distinct reference reachable in a JSON value, in the order first seen.
 *
 * Structure-agnostic on purpose: sheets store an image URL at
 * `sheets[tab].images[id].src`, slides and boards at `data.src` on an image
 * element and on a background fill, and a type that grows another site later is
 * covered without editing this file. The cost of walking a whole root rather
 * than known paths is one traversal of data already in memory.
 */
export function collectImageRefs(
  value: unknown,
  sourceWorkspaceId: string,
  trustedOrigin?: string,
): CollectedRefs {
  const rehostable = new Map<string, ImageRef>();
  const foreign = new Map<string, ImageRef>();
  let truncated = false;

  const visit = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    const ref = parseImageRef(node, trustedOrigin);
    if (ref) {
      const bucket = isRehostable(ref, sourceWorkspaceId) ? rehostable : foreign;
      if (!bucket.has(ref.url)) bucket.set(ref.url, ref);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const child of Object.values(node)) visit(child, depth + 1);
    }
  };

  visit(value, 0);
  return {
    rehostable: [...rehostable.values()],
    foreign: [...foreign.values()],
    truncated,
  };
}

/**
 * Rewrite every occurrence of the given URLs in a JSON value, returning a new
 * value. Strings that are not keys of `replacements` are returned as they are.
 */
export function rewriteImageRefs<T>(
  value: T,
  replacements: ReadonlyMap<string, string>,
  depth = 0,
): T {
  // Nothing to replace means nothing to rebuild. Without this every copy whose
  // images all failed still paid a full deep clone of the document.
  if (replacements.size === 0) return value;
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') {
    return (replacements.get(value) ?? value) as unknown as T;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((child) =>
      rewriteImageRefs(child, replacements, depth + 1),
    ) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    // `Object.create(null)`, because `JSON.parse` produces `__proto__` as an
    // ordinary own property and assigning it onto a normal object invokes the
    // prototype setter instead — which drops the key and changes the output's
    // prototype. The result is spread into a plain object at the end so what
    // leaves here is still an ordinary value.
    const out = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value)) {
      out[key] = rewriteImageRefs(child, replacements, depth + 1);
    }
    return { ...out } as unknown as T;
  }
  return value;
}

/**
 * Does this note's content reference a workspace-scoped image at all?
 *
 * Deliberately a substring search rather than a parse: a markdown link embeds
 * the URL inside `![alt](…)`, so none of the whole-string rules above apply.
 * It exists only to decide whether a *report* has anything to say, never to
 * decide what may be copied — so a loose match costs a redundant note in a
 * report and nothing else.
 */
export function hasWorkspaceImageLink(content: unknown): boolean {
  const text =
    typeof content === 'string'
      ? content
      : typeof content === 'object' && content !== null
        ? JSON.stringify(content)
        : '';
  return /\/api\/v1\/workspaces\/[A-Za-z0-9_-]{1,200}\/images\//.test(text);
}
