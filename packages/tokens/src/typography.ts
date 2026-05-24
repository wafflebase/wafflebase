export const typography = {
  display:
    '"Fraunces", ui-serif, Georgia, serif',
  body:
    '"Inter", ui-sans-serif, system-ui, sans-serif',
  code:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export type TypographyTokens = typeof typography;
