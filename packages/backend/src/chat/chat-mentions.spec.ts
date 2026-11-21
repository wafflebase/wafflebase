import { parseMentionBody, serializeMention } from '@wafflebase/sheets';
import { canonicalMentions } from './chat-mentions';

const names = new Map([
  ['42', 'victim'],
  ['7', 'alice'],
]);

/** Every token in `body` names a resolved id under its real username. */
function tokensResolve(body: string): boolean {
  return parseMentionBody(body).every(
    (s) =>
      s.type === 'text' ||
      serializeMention({
        userId: s.userId,
        username: names.get(s.userId) ?? '\0',
      }) === serializeMention(s),
  );
}

describe('canonicalMentions', () => {
  it('rewrites a resolved token to the real username', () => {
    expect(canonicalMentions('hi @[ceo](42)', names)).toBe('hi @[victim](42)');
  });

  it.each([
    '@[[FAKE](999999)](42)',
    '@[[FAKE](abc)](42)',
    '@[@[FAKE](999999)](42)',
    '@[[[a](0)](0)](42)',
    '@[(](1)](42)',
    'x @[[a](1) @[[b](2)](7)](42)',
    '@[](9)[](42)',
    '@@[](9)[](42)',
    '@[@[@[(](9)[](42)',
  ])('does not let a flattened token re-form one: %s', (raw) => {
    const out = canonicalMentions(raw, names)!;

    expect(tokensResolve(out)).toBe(true);
    expect(canonicalMentions(out, names)).toBe(out);
  });

  it('is a fixpoint over random nested bodies', () => {
    let seed = 1;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const ids = ['42', '7', '9', '0', 'x'];
    const bits = ['@', '[', ']', '(', ')', 'a', ' '];
    // A token, a near-token missing one piece, or a stray fragment, nested.
    const gen = (depth: number): string => {
      let out = '';
      for (let k = rand(3) + 1; k > 0; k -= 1) {
        if (depth > 0 && rand(2) === 0) {
          const parts = [
            '@[',
            gen(depth - 1),
            '](',
            ids[rand(ids.length)],
            ')',
          ];
          if (rand(4) === 0) parts[rand(parts.length)] = '';
          out += parts.join('');
        } else {
          out += bits[rand(bits.length)];
        }
      }
      return out;
    };
    for (let n = 0; n < 20000; n += 1) {
      const raw = gen(4);
      const out = canonicalMentions(raw, names);
      if (out === null) throw new Error(`unsettled: ${JSON.stringify(raw)}`);
      if (!tokensResolve(out) || canonicalMentions(out, names) !== out) {
        throw new Error(`not canonical: ${JSON.stringify(raw)} -> ${out}`);
      }
    }
  });
});
