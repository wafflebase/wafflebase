/*
 * A STARTING VALUE FOR A REQUIRED PROP, read off its declared type.
 *
 * An app component throws the moment it is mounted bare: `NavMain` maps over `items`,
 * `NavUser` reads `user.username`, `DocumentList` iterates `data`. They are not broken
 * — they are components that take data, mounted with none.
 *
 * The point of a generated default is to get PAST the throw so the component paints and
 * can be styled, which is what this pane is for. It is a plausible shape, not real data,
 * and the editor lets it be replaced: a guess that renders is worth more than an
 * accurate refusal.
 *
 * TYPE STRINGS, not types. The analyser reports what the source wrote — `Array<NavItem>`,
 * `User`, `(accept: string) => void` — with no checker behind it. So this reads shape
 * from syntax and is deliberately shallow: an array is `[]`, a function is a no-op, an
 * object is `{}`. Anything it gets wrong, the field shows and the user corrects.
 */

/** Is this type a function? `() => void`, `(a: string) => void`, `React.Dispatch<…>`. */
const isFn = (t: string) => /=>/.test(t) || /^React\.(Dispatch|SetStateAction)\b/.test(t);

/** Is this type an array? `T[]`, `Array<T>`, `readonly T[]`. */
const isArray = (t: string) => /\[\]\s*$/.test(t) || /^(readonly\s+)?Array\s*</.test(t);

/** A primitive whose literal value is obvious. */
const primitive = (t: string, name: string): unknown | undefined => {
  if (/\bstring\b/.test(t)) return name;
  if (/\bnumber\b/.test(t)) return 0;
  if (/\bboolean\b/.test(t)) return false;
  return undefined;
};

/**
 * The value to hand a prop of this type.
 *
 * `undefined` for a function: functions cannot survive JSON, so the frame substitutes a
 * no-op by NAME rather than carrying a value across. Keeping them out of the editable
 * set is also right — nobody styles a callback.
 */
export function mockValueFor(name: string, type: string): unknown | undefined {
  const t = (type ?? '').trim();
  if (!t || isFn(t)) return undefined;
  if (isArray(t)) return [];
  const p = primitive(t, name);
  if (p !== undefined) return p;
  // A named type (`User`, `Column<TData>`) or an inline object literal. `{}` is enough to
  // survive a property read; a `.map` on a missing array is what actually throws, and
  // that case is handled above.
  return {};
}

/** Every required prop of a component, as an editable JSON object. */
export function mockPropsFor(
  props: { name: string; type: string; optional: boolean }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of props) {
    if (p.optional) continue;
    const v = mockValueFor(p.name, p.type);
    if (v !== undefined) out[p.name] = v;
  }
  return out;
}

/** The required props that are functions — supplied as no-ops, never edited. */
export function noopPropsFor(
  props: { name: string; type: string; optional: boolean }[],
): string[] {
  return props.filter((p) => !p.optional && isFn(p.type ?? '')).map((p) => p.name);
}
