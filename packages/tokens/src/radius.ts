export const radius = {
  base: '0.3rem',
  sm: 'calc(0.3rem - 4px)',
  md: 'calc(0.3rem - 2px)',
  lg: '0.3rem',
  xl: 'calc(0.3rem + 4px)',
} as const;

export type RadiusTokens = typeof radius;
