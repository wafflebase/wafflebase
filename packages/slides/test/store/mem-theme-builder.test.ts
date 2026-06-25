import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';

/**
 * PR3 commit 1 — theme builder store mutations.
 *
 * `updateTheme` / `updateMaster` / `updateLayout` /
 * `updateLayoutPlaceholderFrame` edit the document-local theme, master,
 * and layout copies in place. They are the foundation the in-editor
 * theme builder (PR3) writes through; the cascade to existing slides is
 * commit 2.
 */
describe('MemSlidesStore — theme builder mutations', () => {
  describe('updateTheme', () => {
    it('merges a single color role, leaving the others intact', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateTheme('default-light', { colors: { accent1: '#FF0000' } });
      });
      const theme = store.read().themes.find((t) => t.id === 'default-light')!;
      expect(theme.colors.accent1).toBe('#FF0000');
      // Untouched roles keep their original values.
      expect(theme.colors.text).toBe('#1A1A1A');
      expect(theme.colors.background).toBe('#FFFFFF');
    });

    it('merges a single font role and the theme name', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateTheme('default-light', {
          name: 'Branded',
          fonts: { heading: 'Roboto' },
        });
      });
      const theme = store.read().themes.find((t) => t.id === 'default-light')!;
      expect(theme.name).toBe('Branded');
      expect(theme.fonts.heading).toBe('Roboto');
      expect(theme.fonts.body).toBe('Inter');
    });

    it('throws when the theme is not in the document', () => {
      const store = new MemSlidesStore();
      expect(() =>
        store.batch(() => store.updateTheme('nope', { name: 'x' })),
      ).toThrow();
    });

    it('throws when called outside a batch', () => {
      const store = new MemSlidesStore();
      expect(() => store.updateTheme('default-light', { name: 'x' })).toThrow();
    });
  });

  describe('updateMaster', () => {
    it('sets the background fill', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateMaster('default', {
          background: { fill: { kind: 'srgb', value: '#101010' } },
        });
      });
      const master = store.read().masters.find((m) => m.id === 'default')!;
      expect(master.background.fill).toEqual({ kind: 'srgb', value: '#101010' });
    });

    it('clears the background image with null', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateMaster('default', {
          background: { image: { src: 'data:image/png;base64,AAA' } },
        });
      });
      expect(
        store.read().masters.find((m) => m.id === 'default')!.background.image,
      ).toBeDefined();
      store.batch(() => {
        store.updateMaster('default', { background: { image: null } });
      });
      expect(
        store.read().masters.find((m) => m.id === 'default')!.background.image,
      ).toBeUndefined();
    });

    it('merges a placeholder style field, preserving the others', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateMaster('default', {
          placeholderStyles: { title: { fontSize: 60 } },
        });
      });
      const title = store
        .read()
        .masters.find((m) => m.id === 'default')!.placeholderStyles.title;
      expect(title.fontSize).toBe(60);
      // Other fields of the title style are preserved.
      expect(title.fontRole).toBe('heading');
      expect(title.align).toBe('left');
    });

    it('throws when the master is not in the document', () => {
      const store = new MemSlidesStore();
      expect(() =>
        store.batch(() => store.updateMaster('nope', {})),
      ).toThrow();
    });

    it('throws when called outside a batch', () => {
      const store = new MemSlidesStore();
      expect(() => store.updateMaster('default', {})).toThrow();
    });
  });

  describe('updateLayout', () => {
    it('sets the name and background, then clears the background with null', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateLayout('title-body', {
          name: 'Title + Body',
          background: { fill: { kind: 'srgb', value: '#ABCDEF' } },
        });
      });
      let layout = store.read().layouts.find((l) => l.id === 'title-body')!;
      expect(layout.name).toBe('Title + Body');
      expect(layout.background).toEqual({
        fill: { kind: 'srgb', value: '#ABCDEF' },
      });
      store.batch(() => {
        store.updateLayout('title-body', { background: null });
      });
      layout = store.read().layouts.find((l) => l.id === 'title-body')!;
      expect(layout.background).toBeUndefined();
    });

    it('throws when the layout is not in the document', () => {
      const store = new MemSlidesStore();
      expect(() =>
        store.batch(() => store.updateLayout('nope', { name: 'x' })),
      ).toThrow();
    });

    it('throws when called outside a batch', () => {
      const store = new MemSlidesStore();
      expect(() => store.updateLayout('title-body', { name: 'x' })).toThrow();
    });
  });

  describe('updateLayoutPlaceholderFrame', () => {
    it('updates the frame of the slot identified by (type, index)', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateLayoutPlaceholderFrame(
          'title-body',
          { type: 'title', index: 0 },
          { x: 123, y: 456 },
        );
      });
      const layout = store.read().layouts.find((l) => l.id === 'title-body')!;
      const titleSpec = layout.placeholders.find(
        (p) => p.placeholder.type === 'title',
      )!;
      expect(titleSpec.frame.x).toBe(123);
      expect(titleSpec.frame.y).toBe(456);
      // Width/height untouched (partial merge).
      expect(titleSpec.frame.w).toBeGreaterThan(0);
    });

    it('addresses the second same-type slot by index', () => {
      const store = new MemSlidesStore();
      // title-two-columns has body slots at index 0 and 1.
      store.batch(() => {
        store.updateLayoutPlaceholderFrame(
          'title-two-columns',
          { type: 'body', index: 1 },
          { x: 999 },
        );
      });
      const layout = store
        .read()
        .layouts.find((l) => l.id === 'title-two-columns')!;
      const bodySpecs = layout.placeholders.filter(
        (p) => p.placeholder.type === 'body',
      );
      expect(bodySpecs).toHaveLength(2);
      expect(bodySpecs[0].frame.x).not.toBe(999);
      expect(bodySpecs[1].frame.x).toBe(999);
    });

    it('throws on an unknown layout or an unknown slot', () => {
      const store = new MemSlidesStore();
      expect(() =>
        store.batch(() =>
          store.updateLayoutPlaceholderFrame(
            'nope',
            { type: 'title', index: 0 },
            { x: 1 },
          ),
        ),
      ).toThrow();
      expect(() =>
        store.batch(() =>
          store.updateLayoutPlaceholderFrame(
            'title-body',
            { type: 'title', index: 5 },
            { x: 1 },
          ),
        ),
      ).toThrow();
    });

    it('throws when called outside a batch', () => {
      const store = new MemSlidesStore();
      expect(() =>
        store.updateLayoutPlaceholderFrame(
          'title-body',
          { type: 'title', index: 0 },
          { x: 1 },
        ),
      ).toThrow();
    });
  });

  describe('cascade — layout placeholder geometry → existing slides', () => {
    it('re-flows a matching placeholder on slides using that layout', () => {
      const store = new MemSlidesStore();
      let sid!: string;
      store.batch(() => {
        sid = store.addSlide('title-body');
      });
      store.batch(() => {
        store.updateLayoutPlaceholderFrame(
          'title-body',
          { type: 'title', index: 0 },
          { x: 300, y: 40 },
        );
      });
      const slide = store.read().slides.find((s) => s.id === sid)!;
      const title = slide.elements.find(
        (e) => e.placeholderRef?.type === 'title',
      )!;
      expect(title.frame.x).toBe(300);
      expect(title.frame.y).toBe(40);
    });

    it('leaves a user-moved placeholder untouched', () => {
      const store = new MemSlidesStore();
      let sid!: string;
      let tid!: string;
      store.batch(() => {
        sid = store.addSlide('title-body');
      });
      const slide0 = store.read().slides.find((s) => s.id === sid)!;
      tid = slide0.elements.find((e) => e.placeholderRef?.type === 'title')!.id;
      // User drags the title placeholder somewhere custom.
      store.batch(() => {
        store.updateElementFrame(sid, tid, { x: 17, y: 19 });
      });
      // Layout edit must NOT clobber the user's move.
      store.batch(() => {
        store.updateLayoutPlaceholderFrame(
          'title-body',
          { type: 'title', index: 0 },
          { x: 300 },
        );
      });
      const title = store
        .read()
        .slides.find((s) => s.id === sid)!
        .elements.find((e) => e.id === tid)!;
      expect(title.frame.x).toBe(17);
      expect(title.frame.y).toBe(19);
    });

    it('only affects slides on the edited layout', () => {
      const store = new MemSlidesStore();
      let a!: string;
      let b!: string;
      store.batch(() => {
        a = store.addSlide('title-body');
        b = store.addSlide('title-only');
      });
      const bTitle0 = store
        .read()
        .slides.find((s) => s.id === b)!
        .elements.find((e) => e.placeholderRef?.type === 'title')!.frame.x;
      store.batch(() => {
        store.updateLayoutPlaceholderFrame(
          'title-body',
          { type: 'title', index: 0 },
          { x: 300 },
        );
      });
      const out = store.read();
      expect(
        out.slides
          .find((s) => s.id === a)!
          .elements.find((e) => e.placeholderRef?.type === 'title')!.frame.x,
      ).toBe(300);
      expect(
        out.slides
          .find((s) => s.id === b)!
          .elements.find((e) => e.placeholderRef?.type === 'title')!.frame.x,
      ).toBe(bTitle0);
    });
  });

  describe('cascade — master placeholder type style → existing slides', () => {
    function titleFontSize(blocks: { inlines: { style?: { fontSize?: number } }[] }[]) {
      return blocks[0]?.inlines[0]?.style?.fontSize;
    }

    it('re-seeds typography on empty placeholders of the patched type', () => {
      const store = new MemSlidesStore();
      let sid!: string;
      store.batch(() => {
        sid = store.addSlide('title-body');
      });
      store.batch(() => {
        store.updateMaster('default', {
          placeholderStyles: { title: { fontSize: 80 } },
        });
      });
      const title = store
        .read()
        .slides.find((s) => s.id === sid)!
        .elements.find((e) => e.placeholderRef?.type === 'title')!;
      if (title.type !== 'text') throw new Error('expected text');
      expect(titleFontSize(title.data.blocks)).toBe(80);
    });

    it('leaves a placeholder the user typed into untouched', () => {
      const store = new MemSlidesStore();
      let sid!: string;
      let tid!: string;
      store.batch(() => {
        sid = store.addSlide('title-body');
      });
      tid = store
        .read()
        .slides.find((s) => s.id === sid)!
        .elements.find((e) => e.placeholderRef?.type === 'title')!.id;
      // User types into the title.
      store.batch(() => {
        store.updateElementData(sid, tid, {
          blocks: [
            {
              id: 'p',
              type: 'paragraph',
              inlines: [{ text: 'Hello', style: { fontSize: 44 } }],
              style: {},
            },
          ],
        });
      });
      store.batch(() => {
        store.updateMaster('default', {
          placeholderStyles: { title: { fontSize: 80 } },
        });
      });
      const title = store
        .read()
        .slides.find((s) => s.id === sid)!
        .elements.find((e) => e.id === tid)!;
      if (title.type !== 'text') throw new Error('expected text');
      expect(title.data.blocks[0].inlines[0].text).toBe('Hello');
      expect(titleFontSize(title.data.blocks)).toBe(44);
    });
  });

  describe('document-local layout resolution', () => {
    it('new slides honor an edited layout placeholder geometry', () => {
      const store = new MemSlidesStore();
      store.batch(() => {
        store.updateLayoutPlaceholderFrame(
          'title-body',
          { type: 'title', index: 0 },
          { x: 321 },
        );
      });
      let sid!: string;
      store.batch(() => {
        sid = store.addSlide('title-body');
      });
      const slide = store.read().slides.find((s) => s.id === sid)!;
      const title = slide.elements.find(
        (e) => e.placeholderRef?.type === 'title',
      )!;
      expect(title.frame.x).toBe(321);
    });
  });
});
