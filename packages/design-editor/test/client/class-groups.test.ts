/*
 * Detection decides which controls a node gets, so a wrong match is a control that
 * silently does not apply — or a missing one the user cannot reach at all. These pin
 * the cases that make it wrong.
 */
import { describe, it, expect } from 'vitest';
import { prefixOf, groupsFor, CLASS_GROUPS } from '../../src/client/class-groups.ts';

const keys = (g: { key: string }[]) => g.map((x) => x.key);

describe('prefixOf', () => {
  it('reads the property, not the variant', () => {
    // `md:` says WHEN a class applies, not WHICH property it sets. Reading the prefix
    // off the variant filed `md:flex` under `md` and matched nothing.
    expect(prefixOf('md:flex')).toBe('flex');
    expect(prefixOf('hover:bg-card')).toBe('bg');
    expect(prefixOf('dark:md:text-sm')).toBe('text');
  });

  it('reads a negative utility as its positive property', () => {
    expect(prefixOf('-mt-1')).toBe('mt');
  });

  it('treats a bare utility as its own property', () => {
    expect(prefixOf('flex')).toBe('flex');
    expect(prefixOf('hidden')).toBe('hidden');
  });

  it('takes the LONGEST leading property, so `space-x` is not `space`', () => {
    expect(prefixOf('space-x-2')).toBe('space-x');
    expect(prefixOf('inline-flex')).toBe('inline-flex');
  });

  it('is null for a property no group claims', () => {
    // Not a failure — `size` is real Tailwind, no group offers it, and a class nobody
    // claims must simply open nothing rather than be forced into a neighbour.
    expect(prefixOf('[&>svg]:size-4')).toBeNull();
    expect(prefixOf('shadow-lg')).toBeNull();
  });
});

describe('groupsFor', () => {
  it('opens the groups the node already uses', () => {
    const { relevant } = groupsFor(['flex', 'items-center', 'py-3', 'bg-card']);
    expect(keys(relevant)).toEqual(['display', 'direction', 'align', 'padding']);
  });

  it('does NOT open flex controls for a node that is not a flex container', () => {
    // The whole complaint: four flex controls on every node, useful on almost none.
    const { relevant } = groupsFor(['py-3', 'rounded-md']);
    expect(keys(relevant)).toEqual(['padding', 'radius']);
  });

  it('treats inline-flex as a flex container, because it is one', () => {
    // Found by clicking a real shadcn Button: `inline-flex items-center gap-2.5` opened
    // Align and Gap but not Direction, so the one node type where this matters most had
    // no way to switch to a column.
    expect(keys(groupsFor(['inline-flex']).relevant)).toEqual(['display', 'direction']);
  });

  it('opens padding for any side, not only the shorthand', () => {
    expect(keys(groupsFor(['pt-2']).relevant)).toContain('padding');
    expect(keys(groupsFor(['px-4']).relevant)).toContain('padding');
  });

  it('does not let one property drag in another that merely shares letters', () => {
    // `bg-card` contains a "g"; a substring scan made it open Gap.
    expect(keys(groupsFor(['bg-card']).relevant)).not.toContain('gap');
    // `mx-auto` is margin, never gap.
    expect(keys(groupsFor(['mx-auto']).relevant)).toEqual(['margin']);
  });

  it('keeps every unused group reachable, so detection never removes a possibility', () => {
    const { relevant, rest } = groupsFor(['py-3']);
    expect(relevant.length + rest.length).toBe(CLASS_GROUPS.length);
    expect(keys(rest)).toContain('gap');
  });

  it('opens nothing for a node with no classes, rather than everything', () => {
    expect(groupsFor([]).relevant).toEqual([]);
  });

  it('detects through a variant', () => {
    expect(keys(groupsFor(['md:justify-between']).relevant)).toContain('justify');
  });
});
