import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { imgPlugin } from './img-plugin.js';

/**
 * The plugin under test on the same footing `preview.ts` gives it: raw HTML
 * off, so anything the rule declines is escaped as literal text.
 */
function renderer(): MarkdownIt {
  return new MarkdownIt({ html: false, linkify: true, breaks: true }).use(
    imgPlugin,
  );
}

function render(source: string): string {
  return renderer().render(source);
}

describe('imgPlugin', () => {
  it('renders a GitHub-style sized image', () => {
    const html = render('<img src="drawing.jpg" alt="drawing" width="200" />');

    expect(html).toContain('<img');
    expect(html).toContain('src="drawing.jpg"');
    expect(html).toContain('alt="drawing"');
    expect(html).toContain('width="200"');
    expect(html).not.toContain('&lt;img');
  });

  it('accepts free attribute order, single quotes, and a bare `>`', () => {
    const html = render("<img width=50% alt='icon' src='a.png' height=\"20\">");

    expect(html).toContain('src="a.png"');
    expect(html).toContain('alt="icon"');
    expect(html).toContain('width="50%"');
    expect(html).toContain('height="20"');
  });

  it('renders an image with no dimensions at all', () => {
    const html = render('<img src="a.png" alt="a">');

    expect(html).toContain('src="a.png"');
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
  });

  it('emits an empty alt when none is given, as the renderer requires', () => {
    // markdown-it's image renderer writes into the `alt` attribute slot, so it
    // has to exist even when the source omits it.
    expect(render('<img src="a.png" width="10">')).toContain('alt=""');
  });

  it('escapes the alt text rather than emitting it as markup', () => {
    // Character references in the attribute are resolved (as markdown-it does
    // for a link destination) and then re-escaped on output, so the alt text
    // can never become markup.
    const html = render('<img src="a.png" alt="&lt;b&gt; &amp; more">');

    expect(html).not.toContain('<b>');
    expect(html).toContain('alt="&lt;b&gt; &amp; more"');
  });

  it('sizes an image sitting inline in a sentence', () => {
    const html = render('before <img src="a.png" width="8"> after');

    expect(html).toContain('before <img');
    expect(html).toContain('width="8"');
    expect(html).toContain('after');
  });

  it('sizes an image inside a link', () => {
    const html = render('[<img src="a.png" width="8">](https://example.com)');

    expect(html).toContain('<a href="https://example.com"><img');
    expect(html).toContain('width="8"');
  });

  it('leaves the ![]() form alone', () => {
    const html = render('![alt](a.png)');

    expect(html).toContain('src="a.png"');
    expect(html).toContain('alt="alt"');
  });

  describe('refuses anything outside the allowlist', () => {
    // Each of these must fall through to the `html: false` pipeline and be
    // escaped as literal text — no `<img>` element at all.
    const refused = [
      ['an event handler', '<img src="a.png" onerror="alert(1)">'],
      ['a style attribute', '<img src="a.png" style="width:200px">'],
      ['srcset', '<img src="a.png" srcset="a2.png 2x">'],
      ['a class', '<img src="a.png" class="big">'],
      ['a px dimension', '<img src="a.png" width="200px">'],
      ['a calc dimension', '<img src="a.png" width="calc(100% - 1px)">'],
      ['a negative dimension', '<img src="a.png" width="-5">'],
      ['a fractional dimension', '<img src="a.png" width="12.5">'],
      ['an empty dimension', '<img src="a.png" width="">'],
      ['a missing src', '<img alt="a" width="200">'],
      ['an empty src', '<img src="" width="200">'],
      ['a valueless src', '<img src width="200">'],
      ['a javascript: url', '<img src="javascript:alert(1)" width="20">'],
      ['a repeated attribute', '<img src="a.png" src="b.png">'],
      ['another tag entirely', '<video src="a.mp4">'],
      ['a stray closing tag', '</img>'],
    ] as const;

    for (const [label, source] of refused) {
      it(`refuses ${label}`, () => {
        const html = render(source);

        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;');
      });
    }

    it('never lets a refused tag leak markup, including a following script', () => {
      const html = render('<img src="a.png" onload="x()"><script>y()</script>');

      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  it('does not swallow the rest of the line on a malformed tag', () => {
    // The attribute region cannot span `<`/`>`, so a tag that never closes is
    // just text and the words after it survive.
    const html = render('<img src="a.png" width="200" keeps going');

    expect(html).not.toContain('<img');
    expect(html).toContain('keeps going');
  });
});
