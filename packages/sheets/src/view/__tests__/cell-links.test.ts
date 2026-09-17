import { describe, it, expect } from 'vitest';
import { clipLinkBox, detectLinks, layoutLinkBoxes } from '../cell-links';

/** Convenience: the substrings `detectLinks` picked out of `text`. */
function spanTexts(text: string): Array<string> {
  return detectLinks(text).map((s) => text.slice(s.start, s.end));
}

/** Convenience: the URLs `detectLinks` would navigate to. */
function urls(text: string): Array<string> {
  return detectLinks(text).map((s) => s.url);
}

describe('detectLinks', () => {
  describe('the cells this feature exists for', () => {
    // Taken from the sprint-planning sheet measured in
    // docs/tasks/active/20260917-sheets-cell-link-spans-todo.md, where one
    // screen held 9 URLs and the old whole-cell rule linked 2 of them.

    it('links a URL that follows a label', () => {
      const text = '- PR: https://git.example.com/acme/web/pull/2466';
      expect(spanTexts(text)).toEqual([
        'https://git.example.com/acme/web/pull/2466',
      ]);
    });

    it('keeps a version suffix that is part of the path', () => {
      const text =
        '- 릴리즈노트: https://git.example.com/acme/media-tool/releases/tag/v0.2.3-rc.5';
      expect(spanTexts(text)).toEqual([
        'https://git.example.com/acme/media-tool/releases/tag/v0.2.3-rc.5',
      ]);
    });

    it('links every URL in a multi-line cell', () => {
      const text = [
        '시제품 : https://open-api-test-partner.example.com/sign-up',
        '기획 필요사항 : https://wiki.example.com/x/fCl3WwE',
        '계획 문서: https://notes.example.com/n/11111111-2222-3333-4444-555555555555',
      ].join('\n');
      expect(spanTexts(text)).toEqual([
        'https://open-api-test-partner.example.com/sign-up',
        'https://wiki.example.com/x/fCl3WwE',
        'https://notes.example.com/n/11111111-2222-3333-4444-555555555555',
      ]);
    });

    it('still links a cell whose whole value is a URL', () => {
      const text = 'https://notes.example.com/n/66666666-7777-8888-9999-aaaaaaaaaaaa';
      const spans = detectLinks(text);
      expect(spans).toHaveLength(1);
      expect(spans[0]).toMatchObject({ start: 0, end: text.length, url: text });
    });

    it('links two URLs on one line', () => {
      const text = 'before https://a.example.com then https://b.example.com end';
      expect(spanTexts(text)).toEqual([
        'https://a.example.com',
        'https://b.example.com',
      ]);
    });
  });

  describe('refuses schemeless hostnames', () => {
    // A cell is data: a stray underline changes how the value reads, so the
    // detector is deliberately stricter than the Docs one, which prepends
    // https:// to a bare hostname.

    it.each([
      ['a shell script', 'build.sh'],
      ['a version string', 'v0.2.3-rc.5'],
      ['a branch name', 'creators/26.09.1700'],
      ['a bare hostname', 'example.com'],
      ['a source path', 'src/index.io'],
      ['prose', 'hello world'],
      ['a number', '42'],
    ])('does not link %s', (_label, text) => {
      expect(detectLinks(text)).toEqual([]);
    });
  });

  describe('span boundaries', () => {
    it('stops before an adjacent Korean particle', () => {
      expect(spanTexts('자세한 건 https://example.com를 보세요')).toEqual([
        'https://example.com',
      ]);
    });

    it('strips trailing sentence punctuation', () => {
      expect(spanTexts('see https://example.com.')).toEqual([
        'https://example.com',
      ]);
      expect(spanTexts('see https://example.com, then')).toEqual([
        'https://example.com',
      ]);
    });

    it('strips an unbalanced closing paren', () => {
      expect(spanTexts('(https://example.com)')).toEqual([
        'https://example.com',
      ]);
    });

    it('keeps a balanced paren that belongs to the path', () => {
      expect(spanTexts('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
        'https://en.wikipedia.org/wiki/Foo_(bar)',
      ]);
    });

    it('does not match a scheme glued to a preceding word', () => {
      expect(detectLinks('xhttps://evil.example.com')).toEqual([]);
    });
  });

  describe('normalization', () => {
    it('promotes a www. prefix to https', () => {
      expect(urls('see www.example.com today')).toEqual([
        'https://www.example.com',
      ]);
    });

    it('promotes a bare email address to mailto', () => {
      expect(urls('담당: foo.bar@example.com')).toEqual([
        'mailto:foo.bar@example.com',
      ]);
    });

    it('does not take an email out of a URL that already contains one', () => {
      expect(urls('https://example.com/u@h/x')).toEqual([
        'https://example.com/u@h/x',
      ]);
    });

    it('leaves the painted span as the author typed it', () => {
      const text = 'see www.example.com today';
      expect(spanTexts(text)).toEqual(['www.example.com']);
    });
  });

  describe('stays linear on adversarial text', () => {
    // Detection runs per line, per visible cell, per frame. An alternation
    // like `[A-Za-z0-9._%+-]+@` backtracks quadratically on a long unbroken
    // run of those characters, and a 32k cell took ~2s per pass — enough to
    // freeze the grid for every viewer of a shared document, read-only
    // included. These are the shapes that did it.

    it.each([
      ['a run with no address after it', 'a'.repeat(32767) + '@'],
      ['a run that only looks like a scheme', 'a'.repeat(32767) + '://x'],
      ['repeated local-part characters', 'AB.cd_ef-12'.repeat(2000) + ' a@x.com'],
      ['many adjacent at-signs', 'a@'.repeat(8000)],
    ])('scans %s in well under a frame', (_label, text) => {
      const started = performance.now();
      detectLinks(text);
      expect(performance.now() - started).toBeLessThan(150);
    });
  });

  describe('scheme and address do not eat each other', () => {
    it('invents nothing from a run glued to a scheme', () => {
      // The naive read is `a.b@c.dhttps`, i.e. a mailto: to a domain nobody
      // typed. Nothing is linked instead: the trailing `https://…` is refused
      // by the same glued-left rule that refuses `xhttps://evil.example.com`,
      // and for the same reason — in a cell full of ids and paths, a link the
      // author did not write is worse than a link they have to retype.
      expect(detectLinks('a.b@c.dhttps://real.example.com')).toEqual([]);
    });

    it('paints a literal mailto: as part of the link', () => {
      expect(spanTexts('mailto:foo@bar.com')).toEqual(['mailto:foo@bar.com']);
      expect(urls('mailto:foo@bar.com')).toEqual(['mailto:foo@bar.com']);
    });

    it('keeps an address whose text ends in a sentence colon', () => {
      expect(urls('담당 foo@bar.com: 확인')).toEqual([
        'mailto:foo@bar.com',
      ]);
    });

    it('refuses an address with no real TLD', () => {
      expect(detectLinks('a@b')).toEqual([]);
      expect(detectLinks('a@b.c')).toEqual([]);
      expect(detectLinks('a@b..com')).toEqual([]);
    });
  });

  describe('safety', () => {
    it.each([
      ['javascript', 'javascript:alert(1)'],
      ['data', 'data:text/html,<h1>x</h1>'],
      ['file', 'file:///etc/passwd'],
    ])('refuses a %s URL', (_label, text) => {
      expect(detectLinks(text)).toEqual([]);
    });

    it('refuses a scheme with nothing after it', () => {
      expect(detectLinks('https://')).toEqual([]);
    });

    // These reach `toUrl`/`isSafeUrl` rather than being dropped by the cheap
    // reject, so they exercise the gate itself rather than the shortcut.
    it.each([
      ['an unparseable authority', 'see https://[ here'],
      ['a stray percent escape', 'see https://% here'],
    ])('refuses %s', (_label, text) => {
      expect(detectLinks(text)).toEqual([]);
    });
  });

  describe('empty input', () => {
    it.each([
      ['empty', ''],
      ['blank', '   '],
    ])('returns no spans for %s input', (_label, text) => {
      expect(detectLinks(text)).toEqual([]);
    });
  });
});

describe('layoutLinkBoxes', () => {
  // Matches the canvas mock in overlay-peer-labels.test.ts.
  const measure = (text: string) => text.length * 7;

  it('offsets a span by the width of the text before it', () => {
    const line = 'PR: https://x.com';
    const spans = detectLinks(line);
    expect(layoutLinkBoxes(measure, line, spans, 100)).toEqual([
      { x: 100 + 4 * 7, width: 'https://x.com'.length * 7, url: 'https://x.com' },
    ]);
  });

  it('lays out several spans left to right', () => {
    const line = 'https://a.com and https://b.com';
    const boxes = layoutLinkBoxes(measure, line, detectLinks(line), 0);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].x).toBe(0);
    expect(boxes[1].x).toBe(line.indexOf('https://b.com') * 7);
  });

  it('returns nothing when the line has no spans', () => {
    expect(layoutLinkBoxes(measure, 'plain text', [], 0)).toEqual([]);
  });
});

describe('clipLinkBox', () => {
  const clip = { left: 100, top: 50, width: 80, height: 20 };

  it('passes a box that is wholly inside the clip', () => {
    const box = { left: 110, top: 55, width: 40, height: 10 };
    expect(clipLinkBox(box, clip)).toEqual(box);
  });

  it('trims a box that runs past the right edge', () => {
    expect(
      clipLinkBox({ left: 160, top: 55, width: 60, height: 10 }, clip),
    ).toEqual({ left: 160, top: 55, width: 20, height: 10 });
  });

  it('trims a box that starts before the left edge', () => {
    expect(
      clipLinkBox({ left: 80, top: 55, width: 40, height: 10 }, clip),
    ).toEqual({ left: 100, top: 55, width: 20, height: 10 });
  });

  it('trims a line clipped by the bottom of a short row', () => {
    expect(
      clipLinkBox({ left: 110, top: 60, width: 40, height: 16 }, clip),
    ).toEqual({ left: 110, top: 60, width: 40, height: 10 });
  });

  it('drops a box scrolled entirely out of the clip', () => {
    expect(
      clipLinkBox({ left: 200, top: 55, width: 40, height: 10 }, clip),
    ).toBeNull();
    expect(
      clipLinkBox({ left: 110, top: 80, width: 40, height: 10 }, clip),
    ).toBeNull();
  });
});
