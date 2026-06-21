import { describe, it, expect } from 'vitest';

import {
  parseMentionBody,
  serializeMention,
  extractMentionedUserIds,
  mentionBodyToPlainText,
  detectMentionQuery,
  applySelectedMentions,
} from '../../../src/components/comments/mentions.ts';

describe('serializeMention', () => {
  it('encodes a mention as @[username](userId)', () => {
    expect(serializeMention({ userId: 'u_42', username: '김철수' })).toBe(
      '@[김철수](u_42)',
    );
  });

  it('strips "]" from username so the grammar stays unambiguous', () => {
    expect(serializeMention({ userId: 'u1', username: 'a]b' })).toBe(
      '@[ab](u1)',
    );
  });

  it('strips ")" from userId so the grammar stays unambiguous', () => {
    expect(serializeMention({ userId: 'u)1', username: 'a' })).toBe(
      '@[a](u1)',
    );
  });
});

describe('parseMentionBody', () => {
  it('returns an empty array for an empty body', () => {
    expect(parseMentionBody('')).toEqual([]);
  });

  it('returns a single text segment when there are no mentions', () => {
    expect(parseMentionBody('just plain text')).toEqual([
      { type: 'text', value: 'just plain text' },
    ]);
  });

  it('splits text around a single mention', () => {
    expect(parseMentionBody('Hi @[김철수](u_42), review?')).toEqual([
      { type: 'text', value: 'Hi ' },
      { type: 'mention', userId: 'u_42', username: '김철수' },
      { type: 'text', value: ', review?' },
    ]);
  });

  it('handles a mention at the start and end with no surrounding text', () => {
    expect(parseMentionBody('@[a](1)')).toEqual([
      { type: 'mention', userId: '1', username: 'a' },
    ]);
  });

  it('keeps adjacent mentions without empty text segments between them', () => {
    expect(parseMentionBody('@[a](1)@[b](2)')).toEqual([
      { type: 'mention', userId: '1', username: 'a' },
      { type: 'mention', userId: '2', username: 'b' },
    ]);
  });

  it('leaves an unclosed "@[" sequence as plain text', () => {
    expect(parseMentionBody('email me @[foo bar')).toEqual([
      { type: 'text', value: 'email me @[foo bar' },
    ]);
  });

  it('leaves "@[name]" without a "(id)" group as plain text', () => {
    expect(parseMentionBody('a list item @[todo] here')).toEqual([
      { type: 'text', value: 'a list item @[todo] here' },
    ]);
  });
});

describe('round-trip', () => {
  it('parse(serialize(ref)) yields the original mention', () => {
    const ref = { userId: 'u_99', username: '김영희' };
    expect(parseMentionBody(serializeMention(ref))).toEqual([
      { type: 'mention', userId: 'u_99', username: '김영희' },
    ]);
  });
});

describe('extractMentionedUserIds', () => {
  it('returns the ids of all mentions in document order', () => {
    expect(extractMentionedUserIds('hi @[a](1) and @[b](2)')).toEqual([
      '1',
      '2',
    ]);
  });

  it('de-duplicates repeated mentions of the same user', () => {
    expect(extractMentionedUserIds('@[a](1) @[a](1) @[b](2)')).toEqual([
      '1',
      '2',
    ]);
  });

  it('returns an empty array when there are no mentions', () => {
    expect(extractMentionedUserIds('plain text')).toEqual([]);
  });
});

describe('mentionBodyToPlainText', () => {
  it('renders each mention as @username for previews', () => {
    expect(mentionBodyToPlainText('Hi @[김철수](u_42), review?')).toBe(
      'Hi @김철수, review?',
    );
  });

  it('leaves bodies without mentions unchanged', () => {
    expect(mentionBodyToPlainText('plain text')).toBe('plain text');
  });
});

describe('detectMentionQuery', () => {
  it('detects an in-progress query before the caret', () => {
    expect(detectMentionQuery('hi @ki', 6)).toEqual({ query: 'ki', start: 3 });
  });

  it('detects a bare "@" as an empty query', () => {
    expect(detectMentionQuery('@', 1)).toEqual({ query: '', start: 0 });
  });

  it('uses the caret position, not the end of the string', () => {
    expect(detectMentionQuery('hi @kim', 5)).toEqual({ query: 'k', start: 3 });
  });

  it('returns null when "@" is not at a word boundary (email)', () => {
    expect(detectMentionQuery('mail a@b', 8)).toBeNull();
  });

  it('returns null once the query contains whitespace', () => {
    expect(detectMentionQuery('hi @kim now', 11)).toBeNull();
  });

  it('returns null when there is no "@" before the caret', () => {
    expect(detectMentionQuery('hello ', 6)).toBeNull();
  });

  it('triggers after non-login text typed with no space (CJK)', () => {
    expect(detectMentionQuery('안녕@kim', 6)).toEqual({ query: 'kim', start: 2 });
  });
});

describe('applySelectedMentions', () => {
  it('tokenizes a selected mention', () => {
    expect(
      applySelectedMentions('hi @kim', [{ username: 'kim', userId: 'u1' }]),
    ).toBe('hi @[kim](u1)');
  });

  it('does not let a shorter username match inside a longer one', () => {
    expect(
      applySelectedMentions('@kim and @kimchi', [
        { username: 'kim', userId: 'u1' },
        { username: 'kimchi', userId: 'u2' },
      ]),
    ).toBe('@[kim](u1) and @[kimchi](u2)');
  });

  it('drops a mention whose text was edited after selection', () => {
    expect(
      applySelectedMentions('@kimX', [{ username: 'kim', userId: 'u1' }]),
    ).toBe('@kimX');
  });

  it('tokenizes every occurrence of a selected user', () => {
    expect(
      applySelectedMentions('@kim @kim', [{ username: 'kim', userId: 'u1' }]),
    ).toBe('@[kim](u1) @[kim](u1)');
  });

  it('leaves unselected "@words" as plain text', () => {
    expect(applySelectedMentions('hi @bob', [])).toBe('hi @bob');
  });
});
