import { describe, it, expect, afterEach } from 'vitest';
import { NotePreview } from './preview.js';
import { setImageUrlResolver } from './preview.js';

/**
 * The preview's src → fetch-URL seam. A shared-link mount installs a resolver
 * that appends its `?token=` to workspace image URLs so an anonymous viewer
 * can load them; without it every image in a shared note 403s (issue: shared
 * note images broken, the deferred half of PR #955).
 */
describe('NotePreview image URL resolver', () => {
  afterEach(() => setImageUrlResolver(null));

  it('is identity by default', () => {
    const preview = new NotePreview();
    preview.render('![alt](https://cdn.example.com/img.png)');
    expect(preview.el.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/img.png',
    );
  });

  it('rewrites a markdown image src through the installed resolver', () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    const preview = new NotePreview();
    preview.render('![alt](https://api.example.com/images/a.png)');
    expect(preview.el.querySelector('img')?.getAttribute('src')).toBe(
      'https://api.example.com/images/a.png?token=t1',
    );
  });

  it('rewrites a sized <img> tag src too', () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    const preview = new NotePreview();
    preview.render('<img src="https://api.example.com/images/a.png" width="200">');
    const img = preview.el.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      'https://api.example.com/images/a.png?token=t1',
    );
    expect(img?.getAttribute('width')).toBe('200');
  });

  it('keeps the lazy-loading attributes the default rule adds', () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    const preview = new NotePreview();
    preview.render('![alt](https://api.example.com/images/a.png)');
    const img = preview.el.querySelector('img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
  });

  it('restores identity when the resolver is cleared', () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    setImageUrlResolver(null);
    const preview = new NotePreview();
    preview.render('![alt](https://api.example.com/images/a.png)');
    expect(preview.el.querySelector('img')?.getAttribute('src')).toBe(
      'https://api.example.com/images/a.png',
    );
  });

  it('does not let a rewritten src escape markdown-it escaping', () => {
    setImageUrlResolver(() => '" onerror="alert(1)');
    const preview = new NotePreview();
    preview.render('![alt](https://api.example.com/images/a.png)');
    const img = preview.el.querySelector('img');
    expect(img?.getAttribute('src')).toBe('" onerror="alert(1)');
    expect(img?.hasAttribute('onerror')).toBe(false);
  });

  it('re-resolves on every render so a token change takes effect', () => {
    const preview = new NotePreview();
    const src = 'https://api.example.com/images/a.png';

    setImageUrlResolver((s) => `${s}?token=first`);
    preview.render(`![alt](${src})`);
    expect(preview.el.querySelector('img')?.getAttribute('src')).toBe(
      `${src}?token=first`,
    );

    setImageUrlResolver((s) => `${s}?token=second`);
    preview.render(`![alt](${src})`);
    expect(preview.el.querySelector('img')?.getAttribute('src')).toBe(
      `${src}?token=second`,
    );
  });
});
