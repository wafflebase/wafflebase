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
