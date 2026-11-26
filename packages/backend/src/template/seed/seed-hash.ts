import { createHash } from 'node:crypto';
import type { SeedContent, TemplateSeed } from './types';

/**
 * Seed identity: the derived document id and the hashes `sync:templates`
 * keys its idempotency on
 * (docs/design/template-catalog-scaling.md §3).
 *
 * Pure and free of Nest so `template:dump` can compute the same `contentHash`
 * without booting an application context: the renderer echoes it back in its
 * manifest, and `sync:templates` refuses a thumbnail rendered from content
 * that is no longer the catalogue's.
 */

/**
 * JSON with object keys sorted, so two structurally equal values hash the
 * same whatever order their keys were written in. `undefined` members are
 * dropped exactly as `JSON.stringify` drops them, so an optional field left
 * out and one set to `undefined` are the same content.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * A stable document id per seed slug.
 *
 * Idempotency has to key on *something*, and every alternative is worse: a
 * title match breaks the moment somebody renames the document, and a
 * side-file of ids is state to lose. Deriving the id from the slug means a
 * re-run finds exactly the document it created last time, on any deployment,
 * with nothing to keep in sync. Formatted as a v5-shaped UUID because the
 * column is one.
 */
export function seedDocumentId(slug: string): string {
  const h = createHash('sha1')
    .update(`wafflebase-template-seed:${slug}`)
    .digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) +
      h.slice(18, 20),
    h.slice(20, 32),
  ].join('-');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Rename every `id` in `value` to a positional token, everywhere it appears.
 *
 * The catalogue's ids are not stable across module loads: `applyLayoutToSlide`
 * stamps placeholders with `generateId()` (random), and the builders' counters
 * shift whenever a template is added before another (see `builders.ts`). A
 * hash over the raw content would therefore change on every run, and
 * `sync:templates` would rewrite and re-approve every seed every time. What
 * the hash has to capture is the content's *shape* — which element refers to
 * which — not the names, so ids are numbered in traversal order and every
 * string that is an id, or starts with `<id>-` (a block keyed off its
 * element), takes the token in its place. Object keys are renamed the same
 * way, for maps keyed by id.
 */
function canonicalizeIds(value: unknown): unknown {
  const tokens = new Map<string, string>();
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(collect);
    } else if (v && typeof v === 'object') {
      const id = (v as { id?: unknown }).id;
      if (typeof id === 'string' && !tokens.has(id)) {
        tokens.set(id, `#${tokens.size}`);
      }
      Object.values(v).forEach(collect);
    }
  };
  collect(value);

  const rename = (s: string): string => {
    const exact = tokens.get(s);
    if (exact) return exact;
    for (let i = s.indexOf('-'); i > 0; i = s.indexOf('-', i + 1)) {
      const token = tokens.get(s.slice(0, i));
      if (token) return token + s.slice(i);
    }
    return s;
  };
  const rewrite = (v: unknown): unknown => {
    if (typeof v === 'string') return rename(v);
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, child]) => [rename(k), rewrite(child)]),
      );
    }
    return v;
  };
  return rewrite(value);
}

/**
 * What the seeded document holds, independent of the ids the catalogue
 * happened to generate on this load.
 */
export function seedContentHash(content: SeedContent): string {
  return sha256(stableStringify(canonicalizeIds(content)));
}

/**
 * What the listing says about it: the card fields plus `tags`. Tags are not a
 * `CARD_FIELD` (changing them does not return a listing to review), but they
 * are still catalogue state the listing has to be brought in line with.
 */
export function seedCardHash(
  seed: Pick<TemplateSeed, 'title' | 'description' | 'category' | 'tags'>,
): string {
  return sha256(
    stableStringify({
      title: seed.title,
      description: seed.description,
      category: seed.category,
      tags: seed.tags,
    }),
  );
}
