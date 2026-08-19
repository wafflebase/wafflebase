// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddTokenDraft } from '../../../src/shell/panels/AddTokenRow.tsx';
import { TokenEditorPanel } from '../../../src/shell/panels/TokenEditorPanel.tsx';
import type { TokensResult } from '../../../src/client/bridge.ts';
import type { TokenFamilyMeta } from '../../../src/tokens/adapter.ts';

/**
 * The token panels, at the points where the port had to CHANGE behaviour.
 *
 * Everything here is about the §6 inversion: the prototype read a compiled-in `FAMILY_META`
 * whose values were wafflebase's own file paths and variable prefixes, and these panels read
 * `GET /tokens` instead. So the tests are about what happens when the adapter reports
 * something different, or nothing at all — the cases a hardcoded table could not have.
 *
 * The render-loop test is a REGRESSION test, not a hypothetical: mounting the token editor
 * against an adapter with no `bindings.themed` looped until React threw #185.
 */

let root: Root | null = null;

function render(ui: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const family = (over: Partial<TokenFamilyMeta> = {}): TokenFamilyMeta => ({
  family: 'semantic',
  label: 'Colour',
  file: 'app/tokens/colours.ts',
  cssVarPrefix: '--',
  themeVarPrefix: '--color-',
  utilityPrefix: 'bg-',
  placeholder: 'oklch(0.7 0.1 250)',
  defaultValue: '#000000',
  ...over,
});

describe('AddTokenDraft — names come from the adapter', () => {
  const props = (over: Record<string, unknown> = {}) => ({
    family: 'semantic' as const,
    families: [family()],
    existingKeys: new Set<string>(),
    onStage: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  });

  it('seeds the value from the family’s own default', () => {
    const host = render(<AddTokenDraft {...props({ families: [family({ defaultValue: '#abcdef' })] })} />);
    // The VALUE input, not the first one — that is the name field, which starts empty.
    const values = [...host.querySelectorAll<HTMLInputElement>('input')].map((i) => i.value);
    expect(values).toContain('#abcdef');
    expect(host.textContent).toContain('New Colour');
  });

  it('previews the variable using the family’s prefix, not a wafflebase one', () => {
    // The whole point of the inversion: a project whose tokens are emitted as `--wb-*` sees
    // that, and this panel never learns why.
    const host = render(
      <AddTokenDraft {...props({ families: [family({ cssVarPrefix: '--wb-' })] })} />,
    );
    const input = host.querySelector<HTMLInputElement>('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'brand accent');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('--wb-brand-accent');
  });

  it('REFUSES when the adapter carries no such family', () => {
    // Not an empty input that stages nothing: the reason is a configuration fact and is
    // named. A compiled-in table could not reach this state at all.
    const host = render(<AddTokenDraft {...props({ families: [] })} />);
    expect(host.textContent).toContain('no semantic family');
    expect(host.querySelector('input')).toBeNull();
  });

  it('reports a name the server would reject, before the round trip', () => {
    const onStage = vi.fn();
    const host = render(<AddTokenDraft {...props({ onStage })} />);
    const input = host.querySelector<HTMLInputElement>('input')!;
    const type = (v: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    // Digits-first is not an identifier, which `tokenEditOf` refuses server-side.
    type('9lives');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onStage).not.toHaveBeenCalled();
    expect(host.textContent?.toLowerCase()).toContain('invalid token name');
  });

  it('stages a valid name through the shared rule', () => {
    const onStage = vi.fn();
    const host = render(<AddTokenDraft {...props({ onStage })} />);
    const input = host.querySelector<HTMLInputElement>('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Brand Accent');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onStage).toHaveBeenCalledWith(
      expect.objectContaining({ family: 'semantic', kebabKey: 'brand-accent', camelKey: 'brandAccent' }),
    );
  });
});

describe('TokenEditorPanel', () => {
  const props = (tokens: TokensResult | null) => ({
    dark: false,
    tokens,
    tokenEdits: {},
    onTokenEdit: vi.fn(),
    tokenAdds: {},
    onTokenAdd: vi.fn(),
    rebinds: {},
    onRebind: vi.fn(),
    paletteEdits: {},
    onPaletteEdit: vi.fn(),
  });

  it('REGRESSION: mounts against an adapter with no themed bindings', () => {
    // This looped until React threw #185. `bindings` was rebuilt as a fresh `{}` on every
    // render, so `colorRoles` → `colorSpecs` → `allSpecs` all changed identity, the
    // computed-CSS layout effect refired, and it set a new state object each pass.
    //
    // TWO guards now stop it and EITHER is sufficient — the memo removes the churn, the
    // equality check makes the loop unreachable. So this test only fails when both are
    // gone, which is what the revert-proof for it removes. Deliberate: defence in depth on
    // a failure whose symptom is a dead tab.
    // Filtered to the LOOP signal. React also warns here about the act() environment,
    // which is unrelated and would make this assertion fail for the wrong reason.
    const loops: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      const text = a.map(String).join(' ');
      if (/Maximum update depth|#185|Minified React error 185/.test(text)) loops.push(text);
    });
    const host = render(
      <TokenEditorPanel
        {...props({ ok: true, adapter: 'configured', families: [family({ family: 'radius', label: 'Radius', cssVarPrefix: '--radius-' })] })}
      />,
    );
    expect(host.textContent).toContain('Radius');
    expect(loops).toEqual([]);
  });

  it('mounts with no adapter at all, and says the panels are read-only', () => {
    const host = render(<TokenEditorPanel {...props({ ok: true, adapter: null, reason: 'no adapter' })} />);
    expect(host.textContent).toBeTruthy();
  });

  it('renders NO rows for a family the adapter does not report', () => {
    // Rows addressed at a family the server would refuse are worse than an empty section:
    // every edit made in them fails at save time.
    //
    // `bindings.themed.light` is populated on purpose — otherwise there are no roles to
    // build rows FROM, and the assertion passes for the wrong reason.
    const bindings = {
      themed: { light: { primary: { kind: 'literal' as const, value: '#111' } }, dark: {} },
      refs: [],
    };
    const withFamily = render(
      <TokenEditorPanel {...props({ ok: true, adapter: 'configured', families: [family()], bindings })} />,
    );
    expect(withFamily.textContent).toContain('--primary');

    act(() => root!.unmount());
    root = null;
    const without = render(
      <TokenEditorPanel {...props({ ok: true, adapter: 'configured', families: [], bindings })} />,
    );
    expect(without.textContent).not.toContain('--primary');
  });

  it('shows the variable name ONLY when the pipeline emits it', () => {
    // `radius.base` is emitted as the bare `--radius`, and `sm`/`md` are not emitted at all —
    // nothing in the payload maps a source member to its property, so the prefix name
    // `--radius-base` was a claim the panel could not support. Now an unverified row shows
    // its source path, which `toTokenIntent` proves is the real address.
    const host = render(
      <TokenEditorPanel
        {...props({
          ok: true,
          adapter: 'configured',
          families: [family({ family: 'radius', label: 'Radius', cssVarPrefix: '--radius-', themeVarPrefix: '--radius-' })],
          vars: { light: { '--radius': '0.3rem' }, dark: {} },
          bindings: {
            themed: { light: {}, dark: {} },
            refs: [],
            leaves: { radius: { base: '0.3rem', sm: 'calc(0.3rem - 4px)' } },
          },
        })}
      />,
    );
    expect(host.textContent).not.toContain('--radius-base');
    expect(host.textContent).not.toContain('--radius-sm');
    // Both rows fall back to their source path.
    expect(host.textContent).toContain('radius.base');
    expect(host.textContent).toContain('radius.sm');
  });

  it('shows the name when the prefix rule DOES describe the emission', () => {
    // `typo` is the family where the contract holds: `--font-` + `body` is what lands.
    const host = render(
      <TokenEditorPanel
        {...props({
          ok: true,
          adapter: 'configured',
          families: [family({ family: 'typo', label: 'Font', cssVarPrefix: '--font-', themeVarPrefix: '--font-' })],
          vars: { light: { '--font-body': 'Inter' }, dark: {} },
          bindings: { themed: { light: {}, dark: {} }, refs: [], leaves: { typo: { body: 'Inter' } } },
        })}
      />,
    );
    expect(host.textContent).toContain('--font-body');
  });


});

/**
 * The panels are the only place in this package whose text a CONSUMER reads, and one of
 * them shipped the prototype's namespace and package name in a rendered error — telling
 * the user to run a filter that does not exist. Routes belong in `BASE`; nothing under
 * `panels/` may name the old package at all, in copy or in comment.
 */
describe('the panels never name the prototype package', () => {
  it('has no `design-sdk` anywhere under panels/', async () => {
    // `process.cwd()`, not `import.meta.url`: this file runs under jsdom, where
    // `import.meta.url` is an http URL and `node:fs` rejects it.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src/shell/panels');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('design-sdk'));
    expect(offenders).toEqual([]);
  });
});
