// @vitest-environment jsdom
/**
 * Tests for CommentBody — renders a plain-string comment body, turning
 * inline @[username](userId) tokens into mention chips while leaving the
 * surrounding text intact.
 *
 * JSX is avoided (matching the package's tests/**\/*.test.ts runner) by
 * building elements with React.createElement.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CommentBody } from '../../../src/components/comments/components/CommentBody.tsx';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('CommentBody', () => {
  test('renders plain text verbatim with no mention chips', () => {
    const el = render(h(CommentBody, { body: 'just plain text' }));
    expect(el.textContent).toBe('just plain text');
    expect(el.querySelector('[data-mention-user-id]')).toBeNull();
  });

  test('renders a mention as a chip carrying the userId and username', () => {
    const el = render(
      h(CommentBody, { body: 'Hi @[김철수](u_42), review?' }),
    );
    const chip = el.querySelector(
      '[data-mention-user-id="u_42"]',
    ) as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('@김철수');
    expect(chip!.getAttribute('title')).toBe('김철수');
  });

  test('keeps the text surrounding a mention', () => {
    const el = render(
      h(CommentBody, { body: 'Hi @[김철수](u_42), review?' }),
    );
    expect(el.textContent).toBe('Hi @김철수, review?');
  });

  test('renders multiple mentions', () => {
    const el = render(h(CommentBody, { body: '@[a](1) and @[b](2)' }));
    expect(el.querySelectorAll('[data-mention-user-id]').length).toBe(2);
  });
});
