/**
 * The three `packages/frontend` modules `providers.tsx` mounts, declared here instead of
 * resolved through a `@/*` path mapping.
 *
 * WHY NOT JUST MAP `@/*`. Measured: mapping it makes `tsc` follow `@/app/Layout` into the
 * whole frontend graph — including the sheets / docs / slides / notes engines — and
 * typecheck all of it under THIS package's options. That is 471 errors, none of them real
 * defects: aligning `types: ["vite/client"]` and `verbatimModuleSyntax` brings it to 184,
 * and the remainder is cross-package friction from `@wafflebase/*` resolving to `src`
 * here and to something else in the frontend's own config. Closing the gap would mean
 * maintaining a second copy of the frontend's tsconfig forever.
 *
 * WHAT IS ACTUALLY LOST, said plainly: if one of these three modules changes its props,
 * `providers.tsx` will not fail here — it will fail in the browser. What is NOT lost is
 * the frontend's own checking; `pnpm frontend typecheck` reads these files under the
 * config that owns them, which is the program that should be checking them.
 *
 * The shapes below are transcribed from the real signatures, so a mistake in
 * `providers.tsx` itself — a missing `children`, a wrong `defaultTheme` — is still caught.
 * Vite resolves the real modules at runtime through the `@` alias in `vite.config.ts`.
 */
declare module '@/components/theme-provider' {
  import type { ReactNode } from 'react';
  export function ThemeProvider(props: {
    children: ReactNode;
    defaultTheme?: 'light' | 'dark' | 'system';
    storageKey?: string;
  }): ReactNode;
}

declare module '@/components/ui/tooltip' {
  import type { ReactNode } from 'react';
  export function TooltipProvider(props: {
    children: ReactNode;
    delayDuration?: number;
  }): ReactNode;
}

declare module '@/app/Layout' {
  import type { ReactNode } from 'react';
  /** Renders an `<Outlet/>`, which is why the shell is a nested route — see `providers.tsx`. */
  export default function Layout(): ReactNode;
}
