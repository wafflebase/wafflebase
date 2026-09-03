/**
 * `YSON.parse` does not return plain JSON.
 *
 * A revision snapshot is YSON — JSON plus constructor literals for the CRDT's
 * own value types (`Int(320)`, `Long(1788360894343)`, `Date("…")`,
 * `BinData("…")`, `Counter(Int(1))`, `Text([…])`, `Tree({…})`). The SDK's
 * parser rewrites each literal into a tagged object and hands *that* back, so
 * every integer in a parsed snapshot arrives as `{type: 'Int', value: 320}`
 * rather than `320`. Floats are untouched, because YSON has no literal for
 * them — which is why the damage is invisible in a diff and total at runtime:
 *
 *     "frame": {"w": Int(320), "h": Int(200), "x": 343.66, "y": 170.81}
 *       →      {w: {type:'Int',value:320}, …, x: 343.66, y: 170.81}
 *
 * The engines type those fields `number` and do arithmetic on them, so a
 * previewed slide computed `NaN` for every shape's width and painted only the
 * theme background — a solid dark rectangle that reads as "this version was
 * empty". This walk restores the plain JS values before any engine sees them.
 *
 * `Text` and `Tree` are deliberately *not* unwrapped: they are aggregate CRDTs,
 * not scalars, and `parseNoteSnapshot` hands the `Text` straight to
 * `YSON.textToString`. They are returned by reference, untouched.
 *
 * This duplicates nothing in `packages/backend/src/yorkie/yorkie-json.ts` —
 * those helpers unwrap *live proxies* (`toJSON` string layers, `bigint`) and
 * never see a YSON literal — but a single shared home for both is the right
 * follow-up, since neither package can import the other today.
 */

/** The scalar tags `YSON.parse` emits, mapped to the plain value they wrap. */
const SCALAR_TAGS = new Set(['Int', 'Long', 'Date', 'BinData']);

/** Aggregate CRDTs, which must survive the walk by reference. */
const AGGREGATE_TAGS = new Set(['Text', 'Tree']);

function hasExactKeys(value: object, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/**
 * The plain value behind one tagged scalar, or `undefined` when `value` is not
 * one. The key set is matched exactly, so a model object that merely happens to
 * carry a `type` field (every slides `Element` does) can never be mistaken for
 * a wrapper.
 */
function unwrapScalar(value: object): unknown | undefined {
  const tagged = value as { type?: unknown; value?: unknown; registers?: unknown };
  if (typeof tagged.type !== 'string') return undefined;

  if (SCALAR_TAGS.has(tagged.type) && hasExactKeys(value, ['type', 'value'])) {
    if (tagged.type === 'Int' || tagged.type === 'Long') {
      return typeof tagged.value === 'number' ? tagged.value : undefined;
    }
    if (typeof tagged.value !== 'string') return undefined;
    // `Date` round-trips through `toISOString()` upstream, so this is its
    // exact inverse — and matches what a live Yorkie proxy hands back.
    return tagged.type === 'Date' ? new Date(tagged.value) : tagged.value;
  }

  // A counter nests its own `Int`/`Long` wrapper; a dedup counter adds the
  // register set it uses for idempotency. Both are numbers to every consumer.
  if (tagged.type === 'Counter' && hasExactKeys(value, ['type', 'value'])) {
    return unwrapCounterValue(tagged.value);
  }
  if (
    tagged.type === 'DedupCounter' &&
    hasExactKeys(value, ['type', 'value', 'registers'])
  ) {
    return unwrapCounterValue(tagged.value);
  }

  return undefined;
}

function unwrapCounterValue(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const inner = unwrapScalar(value);
  return typeof inner === 'number' ? inner : undefined;
}

/**
 * Replace every CRDT scalar wrapper in a `YSON.parse` result with its plain JS
 * value, and change nothing else. The walk is total — a wrapper is unwrapped
 * however deep it sits — but `Text`/`Tree` subtrees are returned by reference,
 * so the note adapter still receives a real `YSON.Text`.
 */
export function unwrapYsonScalars<T>(value: unknown): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((item) => walk(item));

  const tag = (value as { type?: unknown }).type;
  if (typeof tag === 'string' && AGGREGATE_TAGS.has(tag)) return value;

  const scalar = unwrapScalar(value);
  if (scalar !== undefined) return scalar;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = walk(child);
  }
  return result;
}
