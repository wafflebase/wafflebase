/**
 * Corner radius scale (DESIGN.md Shapes). Ordered xs ≤ sm < md < lg < xl:
 * xs 2px, sm 2.4px, md 2.8px (controls), lg 4.8px (the base), xl 8.8px
 * (cards, dialogs). The frontend mirrors these in index.css `@theme`; xs is
 * set there too so Tailwind's 2px default cannot drift above sm.
 */
export const radius = {
  base: '0.3rem',
  xs: '0.125rem',
  sm: 'calc(0.3rem - 2.4px)',
  md: 'calc(0.3rem - 2px)',
  lg: '0.3rem',
  xl: 'calc(0.3rem + 4px)',
} as const;

export type RadiusTokens = typeof radius;
