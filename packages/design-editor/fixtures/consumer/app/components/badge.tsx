/*
 * A CVA component, for the class-rewrite half of the gate.
 *
 * `cva` comes from this project's OWN `app/lib/cva.ts`, not from npm, and that file
 * explains why. The short version: through 11a nothing here ever ran, so the import did
 * not need to resolve; 11b's frame mounts the scene, so it does. `extract.mjs`
 * recognises the variant table by the callee being named `cva`, never by its origin, so
 * the shape the gate exercises is unchanged.
 */
import { cva } from '@/lib/cva';

export const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        destructive: 'border-transparent bg-destructive text-primary-foreground',
      },
      size: {
        sm: 'h-5 text-[0.6875rem]',
        md: 'h-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export function Badge({ className, children }: { className?: string; children?: unknown }) {
  return <span className={className}>{children}</span>;
}
