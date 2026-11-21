import { parseMentionBody, serializeMention } from '@wafflebase/sheets';

/**
 * Token syntax a flattened name must not carry. `MENTION_RE` lets a
 * username hold `[`, `(` and `@`, so `@[[FAKE](999999)](42)` parses as a
 * token for 999999 named `[FAKE` followed by the text `](42)`; flattening
 * that token to `@[FAKE` verbatim would join the text into `@[FAKE](42)` —
 * a valid token for user 42 that nobody resolved.
 */
const TOKEN_SYNTAX = /[@[\]()]/g;

/**
 * More passes than any body needs: a pass that changes anything flattens a
 * token, and stripping its syntax leaves the next pass less to re-form.
 */
const MAX_PASSES = 8;

function canonicalPass(raw: string, names: ReadonlyMap<string, string>) {
  return parseMentionBody(raw)
    .map((segment) => {
      if (segment.type === 'text') return segment.value;
      const username = names.get(segment.userId);
      return username === undefined
        ? `@${segment.username.replace(TOKEN_SYNTAX, '')}`
        : serializeMention({ userId: segment.userId, username });
    })
    .join('');
}

/**
 * The body with every mention token rewritten to its target's real
 * username (`names`: user id → username, for the ids that resolved), and
 * every other token flattened to a plain `@name` stripped of token syntax.
 *
 * Stripping alone is not a fixpoint: a flattened `@` can still meet text
 * that starts with `[…](…)` (`@[](9)[](42)` flattens to `@[](42)`). So the
 * pass repeats until it changes nothing, and the result is then a fixpoint
 * by construction — canonicalizing it again with the same `names` returns
 * it unchanged, and every token in it is a resolved id under its real name.
 * Returns null for a body that has not settled within `MAX_PASSES`.
 */
export function canonicalMentions(
  raw: string,
  names: ReadonlyMap<string, string>,
): string | null {
  let body = raw;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = canonicalPass(body, names);
    if (next === body) return body;
    body = next;
  }
  return null;
}
