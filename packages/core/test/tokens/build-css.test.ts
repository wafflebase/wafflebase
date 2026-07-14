import { describe, expect, it } from 'vitest';
import { renderTokensCss } from '../../scripts/build-css';

describe('renderTokensCss', () => {
  const css = renderTokensCss();

  it('contains a :root and a .dark block', () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it('emits the Butter & Maple palette variables under :root', () => {
    expect(css).toMatch(/--wb-bg:\s*#FBF6EC;/);
    expect(css).toMatch(/--wb-syrup:\s*#B8651A;/);
    expect(css).toMatch(/--wb-butter:\s*#F4C95D;/);
  });

  it('emits the semantic variables expected by the @theme block', () => {
    expect(css).toMatch(/--background:\s*oklch\(1 0 0\);/);
    expect(css).toMatch(/--primary:\s*#B8651A;/);
    expect(css).toMatch(/--ring:\s*#B8651A;/);
  });

  it('emits dark-mode overrides', () => {
    expect(css).toMatch(/\.dark\s*\{[^}]*--background:\s*oklch\(0\.141/s);
    expect(css).toMatch(/\.dark\s*\{[^}]*--wb-bg:\s*#1C1610;/s);
  });

  it('preserves the terminal palette as a constant across both modes', () => {
    // Same value emitted in :root only (no dark override needed).
    const matches = css.match(/--wb-terminal-bg:\s*#1C1610;/g);
    expect(matches?.length).toBe(1);
  });
});
